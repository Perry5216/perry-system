// Deep syntax scan for n8n expression issues in all chainLlm nodes
const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Find all {{ }} expressions inside text: fields of chainLlm nodes
const nodeBlocks = s.split('@node({');
const issues = [];

for (let i = 1; i < nodeBlocks.length; i++) {
    const block = nodeBlocks[i];
    if (!block.includes('chainLlm')) continue;

    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `UNKNOWN_${i}`;

    // Extract text field content
    const textMatch = block.match(/text:\s*[`"]([\s\S]*?)(?:[`"]\s*\n\s*\};)/);
    if (!textMatch) {
        if (name !== 'Outline') { // Outline uses dynamic prompt
            issues.push(`[${name}] CRITICAL: Could not extract text field`);
        }
        continue;
    }

    const textContent = textMatch[1];

    // Find all {{ }} expressions
    const exprRegex = /\{\{([\s\S]*?)\}\}/g;
    let match;
    while ((match = exprRegex.exec(textContent)) !== null) {
        const expr = match[1].trim();

        // Check for problematic patterns

        // 1. Optional chaining ?.
        if (expr.includes('?.')) {
            issues.push(`[${name}] WARNING: Optional chaining ?. in expression: ${expr.substring(0, 80)}`);
        }

        // 2. Unescaped backticks inside expression
        if (expr.includes('`')) {
            issues.push(`[${name}] WARNING: Backtick inside expression: ${expr.substring(0, 80)}`);
        }

        // 3. Template literals inside expression
        if (expr.includes('${')) {
            issues.push(`[${name}] WARNING: Template literal \${} inside expression: ${expr.substring(0, 80)}`);
        }

        // 4. Smart quotes
        if (expr.match(/[""'']/)) {
            issues.push(`[${name}] WARNING: Smart quotes in expression: ${expr.substring(0, 80)}`);
        }

        // 5. Em-dash or special unicode inside expressions
        if (expr.match(/[—–…]/)) {
            issues.push(`[${name}] WARNING: Special Unicode (em-dash/ellipsis) in expression: ${expr.substring(0, 80)}`);
        }

        // 6. Corrupted Unicode
        if (expr.includes('Ã')) {
            issues.push(`[${name}] CRITICAL: Corrupted Unicode in expression: ${expr.substring(0, 80)}`);
        }

        // 7. Double-encoded quotes
        if (expr.includes('\\"') || expr.includes("\\'")) {
            issues.push(`[${name}] WARNING: Escaped quotes in expression: ${expr.substring(0, 80)}`);
        }

        // 8. Bare -- (could be confused with decrement)
        if (expr.match(/\w--\w/)) {
            issues.push(`[${name}] WARNING: Double dash -- between words in expression: ${expr.substring(0, 80)}`);
        }
    }
}

console.log(`Found ${issues.length} expression issue(s):\n`);
issues.forEach(i => console.log('  ▸', i));
