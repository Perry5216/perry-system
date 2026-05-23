import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { StateStore } from '../state-store.js';

export interface CuratorPassResult {
  dryRun: boolean;
  seeded: string[];
  archived: string[];
  skippedPinned: string[];
  errors: string[];
  backupsCreated: string[];
}

export class CuratorService {
  constructor(
    private workspaceDir: string,
    private stateStore: StateStore,
    private router: AIRouter,
    private log: Logger
  ) {}

  /**
   * Run the curator maintenance pass.
   * - Scans all installed abilities.
   * - Seeds any missing frontmatter 'status' to 'installed'.
   * - Evaluates redundancy / stale status using LLM review (if dryRun is false, or always if requested).
   * - Archives redundant/stale abilities (moves to abilities-archived and updates status) unless pinned.
   */
  async runCuratorPass(opts: { dryRun?: boolean; runLlmReview?: boolean } = {}): Promise<CuratorPassResult> {
    const dryRun = opts.dryRun ?? true;
    const runLlmReview = opts.runLlmReview ?? false;
    const result: CuratorPassResult = {
      dryRun,
      seeded: [],
      archived: [],
      skippedPinned: [],
      errors: [],
      backupsCreated: []
    };

    try {
      // Ensure directories exist
      const installedDir = join(this.workspaceDir, 'abilities-installed');
      const archivedDir = join(this.workspaceDir, 'abilities-archived');
      if (!existsSync(installedDir)) mkdirSync(installedDir, { recursive: true });
      if (!existsSync(archivedDir)) mkdirSync(archivedDir, { recursive: true });

      // 1. Scan installed abilities across all services
      const services = readdirSync(installedDir, { withFileTypes: true })
        .filter(ent => ent.isDirectory())
        .map(ent => ent.name);

      const allAbilities: Array<{ service: string; name: string; path: string; content: string; frontmatter: any; body: string }> = [];

      for (const service of services) {
        const serviceDir = join(installedDir, service);
        const files = readdirSync(serviceDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const path = join(serviceDir, file);
          try {
            const raw = readFileSync(path, 'utf-8');
            const parsed = this.parseAbilityFile(raw);
            allAbilities.push({
              service,
              name: parsed.frontmatter.name || file.replace(/\.md$/, ''),
              path,
              content: raw,
              frontmatter: parsed.frontmatter,
              body: parsed.body
            });
          } catch (err: any) {
            result.errors.push(`Failed to read/parse ability at ${path}: ${err.message}`);
          }
        }
      }

      // Check if curator has ever been initialized. If not, we default to seeding only.
      const isInitialized = this.stateStore.getMeta('curator_initialized') === '1';

      // 2. Seeding status pass (checks if status is missing)
      for (const ability of allAbilities) {
        if (!ability.frontmatter.status) {
          // Seed the status frontmatter
          const updatedContent = this.updateFrontmatter(ability.content, { status: 'installed' });
          if (!dryRun) {
            // Write backup first
            await this.createBackup('curator_seed', [ability]);
            writeFileSync(ability.path, updatedContent, 'utf-8');
            this.log.info('Seeded status for ability', { service: ability.service, name: ability.name });
          }
          result.seeded.push(`${ability.service}/${ability.name}`);
        }
      }

      // If this is the first run and not initialized yet, we mark it initialized and defer mutations
      if (!isInitialized) {
        if (!dryRun) {
          this.stateStore.setMeta('curator_initialized', '1');
        }
        this.log.info('Curator service performing first-run seeding. Deferring mutations.');
        return result;
      }

      // 3. Automated lifecycle transitions (LLM review loop)
      if (runLlmReview && allAbilities.length > 0) {
        this.log.info('Starting curator LLM review loop');
        
        // Group abilities by service for overlap review
        const serviceGroups = new Map<string, typeof allAbilities>();
        for (const ability of allAbilities) {
          if (!serviceGroups.has(ability.service)) {
            serviceGroups.set(ability.service, []);
          }
          serviceGroups.get(ability.service)!.push(ability);
        }

        for (const [service, abilities] of serviceGroups.entries()) {
          if (abilities.length < 2) continue; // Overlap check needs at least 2 abilities
          
          const redundantNames = await this.detectRedundantAbilities(
            service,
            abilities.map(s => ({
              name: s.name,
              description: s.frontmatter.description || '',
              body: s.body
            }))
          );
          for (const name of redundantNames) {
            const ability = abilities.find(s => s.name === name);
            if (!ability) continue;

            // Check if pinned
            const isPinned = this.stateStore.getMeta(`curator_pin:${service}:${name}`) === '1';
            if (isPinned) {
              result.skippedPinned.push(`${service}/${name}`);
              this.log.info('Skipping archived/removal of pinned ability', { service, name });
              continue;
            }

            if (!dryRun) {
              // Create a proposal instead of immediately archiving
              const existingProps = this.stateStore.listCuratorProposals();
              const alreadyProposed = existingProps.some(p => p.service === service && p.ability_name === name && p.action === 'archive' && p.status === 'pending');
              if (!alreadyProposed) {
                const proposalId = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                this.stateStore.addCuratorProposal({
                  id: proposalId,
                  service,
                  ability_name: name,
                  status: 'pending',
                  action: 'archive',
                  details: {
                    reason: 'Detected as redundant or stale during LLM review pass.'
                  }
                });
                this.log.info('Created curator proposal for ability archiving', { service, name, proposalId });
              }
              result.seeded.push(`${service}/${name} (proposed)`);
            } else {
              result.archived.push(`${service}/${name}`);
            }
          }
        }
      }

    } catch (err: any) {
      result.errors.push(`Curator pass failed: ${err.message}`);
    }

    return result;
  }

  private parseAbilityFile(raw: string): { frontmatter: Record<string, string>; body: string } {
    const normalized = raw.replace(/\r\n/g, '\n');
    const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: normalized };
    const block = m[1];
    const body = m[2];
    const frontmatter: any = {};
    for (const line of block.split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (kv) {
        let val = kv[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        frontmatter[kv[1]] = val;
      }
    }
    return { frontmatter, body };
  }

  private updateFrontmatter(content: string, updates: Record<string, string>): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) {
      // Create fresh frontmatter
      const fmLines = ['---'];
      for (const [k, v] of Object.entries(updates)) {
        fmLines.push(`${k}: ${v}`);
      }
      fmLines.push('---');
      return fmLines.join('\n') + '\n\n' + normalized;
    }
    const block = m[1];
    const body = m[2];
    const fm: any = {};
    for (const line of block.split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (kv) {
        fm[kv[1]] = kv[2].trim();
      }
    }
    // Apply updates
    Object.assign(fm, updates);
    
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
      lines.push(`${k}: ${v}`);
    }
    lines.push('---');
    return lines.join('\n') + '\n' + body;
  }

  private async archiveAbility(
    ability: { service: string; name: string; path: string; content: string },
    result: CuratorPassResult
  ): Promise<void> {
    const targetDir = join(this.workspaceDir, 'abilities-archived', ability.service);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${ability.name}.md`);

    // Write backup first
    await this.createBackup('curator_archive', [ability]);
    result.backupsCreated.push(ability.name);

    // Update frontmatter status to archived
    const updatedContent = this.updateFrontmatter(ability.content, { status: 'archived' });

    // Move to archived folder
    writeFileSync(targetPath, updatedContent, 'utf-8');
    
    // Delete from active folder
    rmSync(ability.path);

    this.log.info('Archived redundant ability', { service: ability.service, name: ability.name, to: targetPath });
    result.archived.push(`${ability.service}/${ability.name}`);
  }

  /**
   * LLM review pass to detect overlapping/redundant abilities.
   */
  private async detectRedundantAbilities(
    service: string,
    abilities: Array<{ name: string; description: string; body: string }>
  ): Promise<string[]> {
    const system = `You are an ability database curator.
Your task is to identify redundant or overlapping procedural abilities in a system.
Analyze the provided list of abilities and determine if any are duplicates or highly overlapping such that one makes the other obsolete.
If you find redundant abilities, decide which one to keep (usually the more comprehensive or newer one) and list the redundant ones to archive.

You MUST respond ONLY with a JSON object matching this schema:
{
  "redundantAbilityNames": ["name1", "name2"]
}
Do not output any reasoning outside the JSON block.`;

    const abilitiesListStr = abilities.map(s => {
      return `Name: "${s.name}"\nDescription: "${s.description}"\nBody:\n${s.body}\n---\n`;
    }).join('\n');

    const userMessage = `Service: "${service}"
Abilities:\n${abilitiesListStr}

List the names of any redundant abilities that should be archived.`;

    const formatSchema = {
      type: "object",
      properties: {
        redundantAbilityNames: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["redundantAbilityNames"]
    };

    try {
      const response = await this.router.complete({
        provider: 'curator',
        system,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 1024,
        temperature: 0.1,
        format: formatSchema
      });

      const text = response.text.trim();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        parsed = JSON.parse(clean);
      }

      if (parsed && Array.isArray(parsed.redundantAbilityNames)) {
        return parsed.redundantAbilityNames.filter((name: string) => abilities.some(s => s.name === name));
      }
    } catch (err: any) {
      this.log.warn('Redundant ability detection failed', { service, error: err.message });
    }
    return [];
  }

  // ── Backups & Rollbacks ────────────────────────────────────────────────

  async createBackup(action: string, abilities: Array<{ name: string; service: string; path: string; content: string }>): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.workspaceDir, 'abilities-backups', timestamp);
    mkdirSync(backupDir, { recursive: true });

    const manifest: any = {
      timestamp: new Date().toISOString(),
      action,
      abilities: []
    };

    for (const ability of abilities) {
      const serviceDir = join(backupDir, ability.service);
      if (!existsSync(serviceDir)) mkdirSync(serviceDir, { recursive: true });
      
      const backupPath = join(serviceDir, `${ability.name}.md`);
      writeFileSync(backupPath, ability.content, 'utf-8');
      
      manifest.abilities.push({
        name: ability.name,
        service: ability.service,
        originalPath: ability.path,
        backupPath,
      });
    }

    writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    this.log.info('Created abilities backup snapshot', { timestamp, action, count: abilities.length });
    return timestamp;
  }

  async listBackups(): Promise<any[]> {
    const backupDir = join(this.workspaceDir, 'abilities-backups');
    if (!existsSync(backupDir)) return [];
    
    const snapshots: any[] = [];
    try {
      const dirs = readdirSync(backupDir).sort().reverse(); // Show newest first
      for (const dir of dirs) {
        const manifestPath = join(backupDir, dir, 'manifest.json');
        if (existsSync(manifestPath)) {
          try {
            const raw = readFileSync(manifestPath, 'utf-8');
            snapshots.push(JSON.parse(raw));
          } catch {}
        }
      }
    } catch {}
    return snapshots;
  }

  async rollback(timestamp: string): Promise<{ restored: string[]; errors: string[] }> {
    const backupDir = join(this.workspaceDir, 'abilities-backups', timestamp);
    const manifestPath = join(backupDir, 'manifest.json');
    
    if (!existsSync(manifestPath)) {
      throw new Error(`Backup snapshot with timestamp "${timestamp}" not found`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const restored: string[] = [];
    const errors: string[] = [];

    // Perform backup first before rolling back (to allow undoing the rollback!)
    const currentAbilitiesToBackup: any[] = [];
    for (const item of manifest.abilities) {
      if (existsSync(item.originalPath)) {
        try {
          currentAbilitiesToBackup.push({
            name: item.name,
            service: item.service,
            path: item.originalPath,
            content: readFileSync(item.originalPath, 'utf-8')
          });
        } catch {}
      }
    }
    if (currentAbilitiesToBackup.length > 0) {
      await this.createBackup(`pre_rollback_${timestamp}`, currentAbilitiesToBackup);
    }

    for (const item of manifest.abilities) {
      if (existsSync(item.backupPath)) {
        try {
          const parentDir = join(item.originalPath, '..');
          if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
          
          const content = readFileSync(item.backupPath, 'utf-8');
          writeFileSync(item.originalPath, content, 'utf-8');
          restored.push(`${item.service}/${item.name}`);

          // If the ability was archived or deleted, remove it from the archived directory
          const archivedPath = join(this.workspaceDir, 'abilities-archived', item.service, `${item.name}.md`);
          if (existsSync(archivedPath) && item.originalPath.includes('abilities-installed')) {
            try { rmSync(archivedPath); } catch {}
          }
        } catch (err: any) {
          errors.push(`Failed to restore ${item.service}/${item.name}: ${err.message}`);
        }
      } else {
        errors.push(`Backup file not found for ${item.service}/${item.name} at ${item.backupPath}`);
      }
    }

    return { restored, errors };
  }

  /**
   * Apply/execute a curator proposal (either archiving or merging).
   */
  async applyProposal(id: string): Promise<void> {
    const proposals = this.stateStore.listCuratorProposals();
    const prop = proposals.find(p => p.id === id);
    if (!prop) throw new Error('Proposal not found');

    if (prop.status !== 'pending' && prop.status !== 'approved') {
      throw new Error(`Proposal is in status ${prop.status} and cannot be applied`);
    }

    const service = prop.service;
    const abilityName = prop.ability_name;

    if (prop.action === 'archive') {
      const installedDir = join(this.workspaceDir, 'abilities-installed');
      const abilityPath = join(installedDir, service, `${abilityName}.md`);
      if (!existsSync(abilityPath)) {
        throw new Error(`Ability file not found at ${abilityPath}`);
      }
      const raw = readFileSync(abilityPath, 'utf-8');
      const ability = {
        service,
        name: abilityName,
        path: abilityPath,
        content: raw
      };
      
      const result: CuratorPassResult = {
        dryRun: false,
        seeded: [],
        archived: [],
        skippedPinned: [],
        errors: [],
        backupsCreated: []
      };
      await this.archiveAbility(ability, result);
      this.stateStore.updateCuratorProposalStatus(id, 'executed');
    } else if (prop.action === 'merge') {
      const { skillA, skillB, newSkillName } = prop.details;
      await this.executeMerge(service, skillA, skillB, newSkillName);
      this.stateStore.updateCuratorProposalStatus(id, 'executed');
    } else if (prop.action === 'optimize') {
      const { mutated, original } = prop.details;
      if (!mutated) throw new Error('Mutation content missing in proposal details');

      const installedDir = join(this.workspaceDir, 'abilities-installed');
      const paths = [
        join('/app/.claude/commands', `${abilityName}.md`),
        join(installedDir, service, `${abilityName}.md`),
      ];
      let abilityPath: string | null = null;
      for (const p of paths) {
        if (existsSync(p)) {
          abilityPath = p;
          break;
        }
      }
      if (!abilityPath) {
        const dstDir = service === 'worker' ? '/app/.claude/commands' : join(installedDir, service);
        if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
        abilityPath = join(dstDir, `${abilityName}.md`);
      }

      const currentContent = existsSync(abilityPath) ? readFileSync(abilityPath, 'utf-8') : original || '';

      await this.createBackup('curator_optimize', [{
        name: abilityName,
        service,
        path: abilityPath,
        content: currentContent
      }]);

      writeFileSync(abilityPath, mutated, 'utf-8');
      this.log.info('Successfully applied ability prompt optimization', { service, abilityName, path: abilityPath });
      this.stateStore.updateCuratorProposalStatus(id, 'executed');
    }
  }

  /**
   * Immediately synthesize and merge two abilities.
   */
  async mergeAbilities(service: string, skillA: string, skillB: string, newSkillName: string): Promise<void> {
    await this.executeMerge(service, skillA, skillB, newSkillName);
  }

  /**
   * Execute the LLM merge/synthesis process.
   */
  async executeMerge(service: string, skillA: string, skillB: string, newSkillName: string): Promise<void> {
    const installedDir = join(this.workspaceDir, 'abilities-installed');
    const pathA = join(installedDir, service, `${skillA}.md`);
    const pathB = join(installedDir, service, `${skillB}.md`);
    const pathNew = join(installedDir, service, `${newSkillName}.md`);

    if (!existsSync(pathA)) throw new Error(`Ability file A not found at ${pathA}`);
    if (!existsSync(pathB)) throw new Error(`Ability file B not found at ${pathB}`);

    const contentA = readFileSync(pathA, 'utf-8');
    const contentB = readFileSync(pathB, 'utf-8');

    this.log.info('Synthesizing abilities using LLM', { service, skillA, skillB, newSkillName });

    const system = `You are an ability database curator.
Your task is to merge two overlapping procedural abilities into a single, cohesive, parameterized ability.
Analyze the two abilities (frontmatter description, guidelines, rules, code snippets) and synthesize them.
Make sure the new ability is clean, comprehensive, and avoids any duplicate instructions.
The description should summarize the synthesized capabilities.
The body should contain the markdown content of the ability (exclude the frontmatter block).`;

    const userMessage = `Ability A: "${skillA}"
Content:
${contentA}

Ability B: "${skillB}"
Content:
${contentB}

Merge these two abilities into a new ability named "${newSkillName}".`;

    const formatSchema = {
      type: "object",
      properties: {
        description: { type: "string" },
        body: { type: "string" }
      },
      required: ["description", "body"]
    };

    const response = await this.router.complete({
      provider: 'curator',
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2048,
      temperature: 0.1,
      format: formatSchema
    });

    const text = response.text.trim();
    let res: any;
    try {
      res = JSON.parse(text);
    } catch {
      const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
      res = JSON.parse(clean);
    }

    if (!res || typeof res.body !== 'string' || typeof res.description !== 'string') {
      throw new Error(`Invalid synthesis response from LLM: ${text}`);
    }

    // 1. Create backups
    await this.createBackup('curator_merge', [
      { name: skillA, service, path: pathA, content: contentA },
      { name: skillB, service, path: pathB, content: contentB }
    ]);

    // 2. Save new ability file
    const newContent = `---
name: ${newSkillName}
description: ${res.description}
status: installed
---
${res.body}`;

    writeFileSync(pathNew, newContent, 'utf-8');

    // 3. Remove old ability files
    rmSync(pathA);
    rmSync(pathB);

    this.log.info('Successfully merged abilities', { skillA, skillB, merged: newSkillName });

    // 4. Scan codebase and replace references
    this.replaceAbilityReferencesInCodebase(skillA, skillB, newSkillName);
  }

  /**
   * Recursively replace ability references in all code and template files in the workspace.
   */
  private replaceAbilityReferencesInCodebase(skillA: string, skillB: string, newSkillName: string): void {
    const skipDirs = ['node_modules', '.git', '.config', 'abilities-installed', 'abilities-archived', 'abilities-backups', 'dist', 'build'];
    const searchAndReplace = (dir: string) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          if (skipDirs.includes(ent.name)) continue;
          searchAndReplace(join(dir, ent.name));
        } else if (ent.isFile()) {
          const ext = ent.name.split('.').pop() || '';
          const allowedExts = ['ts', 'js', 'json', 'md', 'tsx', 'jsx', 'txt', 'yml', 'yaml'];
          if (!allowedExts.includes(ext)) continue;

          const filepath = join(dir, ent.name);
          try {
            const content = readFileSync(filepath, 'utf-8');
            if (content.includes(skillA) || content.includes(skillB)) {
              let updated = content;
              const regexA = new RegExp(`\\b${skillA}\\b`, 'g');
              const regexB = new RegExp(`\\b${skillB}\\b`, 'g');
              updated = updated.replace(regexA, newSkillName).replace(regexB, newSkillName);
              if (updated !== content) {
                writeFileSync(filepath, updated, 'utf-8');
                this.log.info('Updated references in file', { file: filepath });
              }
            }
          } catch (err: any) {
            this.log.warn('Failed to replace ability reference in file', { file: filepath, error: err.message });
          }
        }
      }
    };
    searchAndReplace(this.workspaceDir);
  }
}
