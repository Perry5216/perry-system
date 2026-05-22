import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { StateStore } from '../state-store.js';

export interface LibrarianPassResult {
  dryRun: boolean;
  seeded: string[];
  archived: string[];
  skippedPinned: string[];
  errors: string[];
  backupsCreated: string[];
}

export class LibrarianService {
  constructor(
    private workspaceDir: string,
    private stateStore: StateStore,
    private router: AIRouter,
    private log: Logger
  ) {}

  /**
   * Run the librarian maintenance pass.
   * - Scans all installed skills.
   * - Seeds any missing frontmatter 'status' to 'installed'.
   * - Evaluates redundancy / stale status using LLM review (if dryRun is false, or always if requested).
   * - Archives redundant/stale skills (moves to skills-archived and updates status) unless pinned.
   */
  async runLibrarianPass(opts: { dryRun?: boolean; runLlmReview?: boolean } = {}): Promise<LibrarianPassResult> {
    const dryRun = opts.dryRun ?? true;
    const runLlmReview = opts.runLlmReview ?? false;
    const result: LibrarianPassResult = {
      dryRun,
      seeded: [],
      archived: [],
      skippedPinned: [],
      errors: [],
      backupsCreated: []
    };

    try {
      // Ensure directories exist
      const installedDir = join(this.workspaceDir, 'skills-installed');
      const archivedDir = join(this.workspaceDir, 'skills-archived');
      if (!existsSync(installedDir)) mkdirSync(installedDir, { recursive: true });
      if (!existsSync(archivedDir)) mkdirSync(archivedDir, { recursive: true });

      // 1. Scan installed skills across all services
      const services = readdirSync(installedDir, { withFileTypes: true })
        .filter(ent => ent.isDirectory())
        .map(ent => ent.name);

      const allSkills: Array<{ service: string; name: string; path: string; content: string; frontmatter: any; body: string }> = [];

      for (const service of services) {
        const serviceDir = join(installedDir, service);
        const files = readdirSync(serviceDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const path = join(serviceDir, file);
          try {
            const raw = readFileSync(path, 'utf-8');
            const parsed = this.parseSkillFile(raw);
            allSkills.push({
              service,
              name: parsed.frontmatter.name || file.replace(/\.md$/, ''),
              path,
              content: raw,
              frontmatter: parsed.frontmatter,
              body: parsed.body
            });
          } catch (err: any) {
            result.errors.push(`Failed to read/parse skill at ${path}: ${err.message}`);
          }
        }
      }

      // Check if librarian has ever been initialized. If not, we default to seeding only.
      const isInitialized = this.stateStore.getMeta('librarian_initialized') === '1';

      // 2. Seeding status pass (checks if status is missing)
      for (const skill of allSkills) {
        if (!skill.frontmatter.status) {
          // Seed the status frontmatter
          const updatedContent = this.updateFrontmatter(skill.content, { status: 'installed' });
          if (!dryRun) {
            // Write backup first
            await this.createBackup('librarian_seed', [skill]);
            writeFileSync(skill.path, updatedContent, 'utf-8');
            this.log.info('Seeded status for skill', { service: skill.service, name: skill.name });
          }
          result.seeded.push(`${skill.service}/${skill.name}`);
        }
      }

      // If this is the first run and not initialized yet, we mark it initialized and defer mutations
      if (!isInitialized) {
        if (!dryRun) {
          this.stateStore.setMeta('librarian_initialized', '1');
        }
        this.log.info('Librarian service performing first-run seeding. Deferring mutations.');
        return result;
      }

      // 3. Automated lifecycle transitions (LLM review loop)
      if (runLlmReview && allSkills.length > 0) {
        this.log.info('Starting librarian LLM review loop');
        
        // Group skills by service for overlap review
        const serviceGroups = new Map<string, typeof allSkills>();
        for (const skill of allSkills) {
          if (!serviceGroups.has(skill.service)) {
            serviceGroups.set(skill.service, []);
          }
          serviceGroups.get(skill.service)!.push(skill);
        }

        for (const [service, skills] of serviceGroups.entries()) {
          if (skills.length < 2) continue; // Overlap check needs at least 2 skills
          
          const redundantNames = await this.detectRedundantSkills(
            service,
            skills.map(s => ({
              name: s.name,
              description: s.frontmatter.description || '',
              body: s.body
            }))
          );
          for (const name of redundantNames) {
            const skill = skills.find(s => s.name === name);
            if (!skill) continue;

            // Check if pinned
            const isPinned = this.stateStore.getMeta(`librarian_pin:${service}:${name}`) === '1';
            if (isPinned) {
              result.skippedPinned.push(`${service}/${name}`);
              this.log.info('Skipping archived/removal of pinned skill', { service, name });
              continue;
            }

            if (!dryRun) {
              // Create a proposal instead of immediately archiving
              const existingProps = this.stateStore.listLibrarianProposals();
              const alreadyProposed = existingProps.some(p => p.service === service && p.skill_name === name && p.action === 'archive' && p.status === 'pending');
              if (!alreadyProposed) {
                const proposalId = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                this.stateStore.addLibrarianProposal({
                  id: proposalId,
                  service,
                  skill_name: name,
                  status: 'pending',
                  action: 'archive',
                  details: {
                    reason: 'Detected as redundant or stale during LLM review pass.'
                  }
                });
                this.log.info('Created librarian proposal for skill archiving', { service, name, proposalId });
              }
              result.seeded.push(`${service}/${name} (proposed)`);
            } else {
              result.archived.push(`${service}/${name}`);
            }
          }
        }
      }

    } catch (err: any) {
      result.errors.push(`Librarian pass failed: ${err.message}`);
    }

    return result;
  }

  private parseSkillFile(raw: string): { frontmatter: Record<string, string>; body: string } {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: raw };
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
    const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) {
      // Create fresh frontmatter
      const fmLines = ['---'];
      for (const [k, v] of Object.entries(updates)) {
        fmLines.push(`${k}: ${v}`);
      }
      fmLines.push('---');
      return fmLines.join('\n') + '\n\n' + content;
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

  private async archiveSkill(
    skill: { service: string; name: string; path: string; content: string },
    result: LibrarianPassResult
  ): Promise<void> {
    const targetDir = join(this.workspaceDir, 'skills-archived', skill.service);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${skill.name}.md`);

    // Write backup first
    await this.createBackup('librarian_archive', [skill]);
    result.backupsCreated.push(skill.name);

    // Update frontmatter status to archived
    const updatedContent = this.updateFrontmatter(skill.content, { status: 'archived' });

    // Move to archived folder
    writeFileSync(targetPath, updatedContent, 'utf-8');
    
    // Delete from active folder
    rmSync(skill.path);

    this.log.info('Archived redundant skill', { service: skill.service, name: skill.name, to: targetPath });
    result.archived.push(`${skill.service}/${skill.name}`);
  }

  /**
   * LLM review pass to detect overlapping/redundant skills.
   */
  private async detectRedundantSkills(
    service: string,
    skills: Array<{ name: string; description: string; body: string }>
  ): Promise<string[]> {
    const system = `You are a skill database librarian.
Your task is to identify redundant or overlapping procedural skills in a system.
Analyze the provided list of skills and determine if any are duplicates or highly overlapping such that one makes the other obsolete.
If you find redundant skills, decide which one to keep (usually the more comprehensive or newer one) and list the redundant ones to archive.

You MUST respond ONLY with a JSON object matching this schema:
{
  "redundantSkillNames": ["name1", "name2"]
}
Do not output any reasoning outside the JSON block.`;

    const skillsListStr = skills.map(s => {
      return `Name: "${s.name}"\nDescription: "${s.description}"\nBody:\n${s.body}\n---\n`;
    }).join('\n');

    const userMessage = `Service: "${service}"
Skills:\n${skillsListStr}

List the names of any redundant skills that should be archived.`;

    const formatSchema = {
      type: "object",
      properties: {
        redundantSkillNames: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["redundantSkillNames"]
    };

    try {
      const response = await this.router.complete({
        provider: 'librarian',
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

      if (parsed && Array.isArray(parsed.redundantSkillNames)) {
        return parsed.redundantSkillNames.filter((name: string) => skills.some(s => s.name === name));
      }
    } catch (err: any) {
      this.log.warn('Redundant skill detection failed', { service, error: err.message });
    }
    return [];
  }

  // ── Backups & Rollbacks ────────────────────────────────────────────────

  async createBackup(action: string, skills: Array<{ name: string; service: string; path: string; content: string }>): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(this.workspaceDir, 'skills-backups', timestamp);
    mkdirSync(backupDir, { recursive: true });

    const manifest: any = {
      timestamp: new Date().toISOString(),
      action,
      skills: []
    };

    for (const skill of skills) {
      const serviceDir = join(backupDir, skill.service);
      if (!existsSync(serviceDir)) mkdirSync(serviceDir, { recursive: true });
      
      const backupPath = join(serviceDir, `${skill.name}.md`);
      writeFileSync(backupPath, skill.content, 'utf-8');
      
      manifest.skills.push({
        name: skill.name,
        service: skill.service,
        originalPath: skill.path,
        backupPath,
      });
    }

    writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    this.log.info('Created skills backup snapshot', { timestamp, action, count: skills.length });
    return timestamp;
  }

  async listBackups(): Promise<any[]> {
    const backupDir = join(this.workspaceDir, 'skills-backups');
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
    const backupDir = join(this.workspaceDir, 'skills-backups', timestamp);
    const manifestPath = join(backupDir, 'manifest.json');
    
    if (!existsSync(manifestPath)) {
      throw new Error(`Backup snapshot with timestamp "${timestamp}" not found`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const restored: string[] = [];
    const errors: string[] = [];

    // Perform backup first before rolling back (to allow undoing the rollback!)
    const currentSkillsToBackup: any[] = [];
    for (const item of manifest.skills) {
      if (existsSync(item.originalPath)) {
        try {
          currentSkillsToBackup.push({
            name: item.name,
            service: item.service,
            path: item.originalPath,
            content: readFileSync(item.originalPath, 'utf-8')
          });
        } catch {}
      }
    }
    if (currentSkillsToBackup.length > 0) {
      await this.createBackup(`pre_rollback_${timestamp}`, currentSkillsToBackup);
    }

    for (const item of manifest.skills) {
      if (existsSync(item.backupPath)) {
        try {
          const parentDir = join(item.originalPath, '..');
          if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
          
          const content = readFileSync(item.backupPath, 'utf-8');
          writeFileSync(item.originalPath, content, 'utf-8');
          restored.push(`${item.service}/${item.name}`);

          // If the skill was archived or deleted, remove it from the archived directory
          const archivedPath = join(this.workspaceDir, 'skills-archived', item.service, `${item.name}.md`);
          if (existsSync(archivedPath) && item.originalPath.includes('skills-installed')) {
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
   * Apply/execute a librarian proposal (either archiving or merging).
   */
  async applyProposal(id: string): Promise<void> {
    const proposals = this.stateStore.listLibrarianProposals();
    const prop = proposals.find(p => p.id === id);
    if (!prop) throw new Error('Proposal not found');

    if (prop.status !== 'pending' && prop.status !== 'approved') {
      throw new Error(`Proposal is in status ${prop.status} and cannot be applied`);
    }

    const service = prop.service;
    const skillName = prop.skill_name;

    if (prop.action === 'archive') {
      const installedDir = join(this.workspaceDir, 'skills-installed');
      const skillPath = join(installedDir, service, `${skillName}.md`);
      if (!existsSync(skillPath)) {
        throw new Error(`Skill file not found at ${skillPath}`);
      }
      const raw = readFileSync(skillPath, 'utf-8');
      const skill = {
        service,
        name: skillName,
        path: skillPath,
        content: raw
      };
      
      const result: LibrarianPassResult = {
        dryRun: false,
        seeded: [],
        archived: [],
        skippedPinned: [],
        errors: [],
        backupsCreated: []
      };
      await this.archiveSkill(skill, result);
      this.stateStore.updateLibrarianProposalStatus(id, 'executed');
    } else if (prop.action === 'merge') {
      const { skillA, skillB, newSkillName } = prop.details;
      await this.executeMerge(service, skillA, skillB, newSkillName);
      this.stateStore.updateLibrarianProposalStatus(id, 'executed');
    }
  }

  /**
   * Immediately synthesize and merge two skills.
   */
  async mergeSkills(service: string, skillA: string, skillB: string, newSkillName: string): Promise<void> {
    await this.executeMerge(service, skillA, skillB, newSkillName);
  }

  /**
   * Execute the LLM merge/synthesis process.
   */
  async executeMerge(service: string, skillA: string, skillB: string, newSkillName: string): Promise<void> {
    const installedDir = join(this.workspaceDir, 'skills-installed');
    const pathA = join(installedDir, service, `${skillA}.md`);
    const pathB = join(installedDir, service, `${skillB}.md`);
    const pathNew = join(installedDir, service, `${newSkillName}.md`);

    if (!existsSync(pathA)) throw new Error(`Skill file A not found at ${pathA}`);
    if (!existsSync(pathB)) throw new Error(`Skill file B not found at ${pathB}`);

    const contentA = readFileSync(pathA, 'utf-8');
    const contentB = readFileSync(pathB, 'utf-8');

    this.log.info('Synthesizing skills using LLM', { service, skillA, skillB, newSkillName });

    const system = `You are a skill database librarian.
Your task is to merge two overlapping procedural skills into a single, cohesive, parameterized skill.
Analyze the two skills (frontmatter description, guidelines, rules, code snippets) and synthesize them.
Make sure the new skill is clean, comprehensive, and avoids any duplicate instructions.
The description should summarize the synthesized capabilities.
The body should contain the markdown content of the skill (exclude the frontmatter block).`;

    const userMessage = `Skill A: "${skillA}"
Content:
${contentA}

Skill B: "${skillB}"
Content:
${contentB}

Merge these two skills into a new skill named "${newSkillName}".`;

    const formatSchema = {
      type: "object",
      properties: {
        description: { type: "string" },
        body: { type: "string" }
      },
      required: ["description", "body"]
    };

    const response = await this.router.complete({
      provider: 'librarian',
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
    await this.createBackup('librarian_merge', [
      { name: skillA, service, path: pathA, content: contentA },
      { name: skillB, service, path: pathB, content: contentB }
    ]);

    // 2. Save new skill file
    const newContent = `---
name: ${newSkillName}
description: ${res.description}
status: installed
---
${res.body}`;

    writeFileSync(pathNew, newContent, 'utf-8');

    // 3. Remove old skill files
    rmSync(pathA);
    rmSync(pathB);

    this.log.info('Successfully merged skills', { skillA, skillB, merged: newSkillName });

    // 4. Scan codebase and replace references
    this.replaceSkillReferencesInCodebase(skillA, skillB, newSkillName);
  }

  /**
   * Recursively replace skill references in all code and template files in the workspace.
   */
  private replaceSkillReferencesInCodebase(skillA: string, skillB: string, newSkillName: string): void {
    const skipDirs = ['node_modules', '.git', '.config', 'skills-installed', 'skills-archived', 'skills-backups', 'dist', 'build'];
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
            this.log.warn('Failed to replace skill reference in file', { file: filepath, error: err.message });
          }
        }
      }
    };
    searchAndReplace(this.workspaceDir);
  }
}
