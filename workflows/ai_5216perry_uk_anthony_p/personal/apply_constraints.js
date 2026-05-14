const fs = require('fs');
let code = fs.readFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', 'utf8');

// 1. ADD NEGATIVE CONSTRAINTS TO SYSTEM PROMPTS
const constraintString = '\\n\\nNEGATIVE CONSTRAINTS:\\n- DO NOT invent new characters, locations, or concepts not present in the braindump.\\n- DO NOT synthesize external lore or tropes from your training data.\\n- Output pure JSON only. Do not wrap in markdown ```json blocks.\\n- Do not include conversational filler.';
const constraintStringEscaped = '\\\\n\\\\nNEGATIVE CONSTRAINTS:\\\\n- DO NOT invent new characters, locations, or concepts not present in the braindump.\\\\n- DO NOT synthesize external lore or tropes from your training data.\\\\n- Output pure JSON only. Do not wrap in markdown ```json blocks.\\\\n- Do not include conversational filler.';

code = code.replace(/(hasOutputParser:\s*false,[\r\n\s]+text:\s*)(['"`])([\s\S]*?)(\2),/g, (match, prefix, quote, inner, quoteEnd) => {
    if (inner.includes('NEGATIVE CONSTRAINTS:')) return match;

    let injectedStr = constraintString;
    // If quote is single or double, use escaped newlines so the generated typescript doesn't break
    if (quote === "'" || quote === '"') {
        injectedStr = constraintStringEscaped;
    }

    return prefix + quote + inner + injectedStr + quoteEnd + ',';
});

console.log('Appended negative constraints.');
fs.writeFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', code);
