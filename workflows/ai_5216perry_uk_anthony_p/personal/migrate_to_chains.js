const fs = require('fs');

const workflowPath = 'd:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts';
let content = fs.readFileSync(workflowPath, 'utf8');

let count = 0;

function convertXmlToJsonObj(promptString) {
    let newPrompt = promptString
        .replace(/<([a-zA-Z0-9_]+)>/g, '"$1": {')
        .replace(/<\/([a-zA-Z0-9_]+)>/g, '},');

    if (newPrompt.startsWith('=')) {
        newPrompt = '={\\n' + newPrompt.substring(1).trim();
        if (newPrompt.endsWith(',')) {
            newPrompt = newPrompt.substring(0, newPrompt.length - 1);
        }
        newPrompt += '\\n}';
    } else {
        newPrompt = '{\\n' + newPrompt.trim();
        if (newPrompt.endsWith(',')) {
            newPrompt = newPrompt.substring(0, newPrompt.length - 1);
        }
        newPrompt += '\\n}';
    }
    return newPrompt;
}

while (true) {
    // Find either single or double quotes
    let index = content.search(/type:\s*['"]@n8n\/n8n-nodes-langchain.agent['"]/);
    if (index === -1) break;

    let startIdx = content.lastIndexOf('@node({', index);
    if (startIdx === -1) break;

    let nextNodeIdx = content.indexOf('@node({', index + 10);
    if (nextNodeIdx === -1) nextNodeIdx = content.length;

    let endIdx = content.lastIndexOf('};', nextNodeIdx);
    if (endIdx === -1) break;
    endIdx += 2;

    let nodeBlock = content.substring(startIdx, endIdx);
    let originalBlock = nodeBlock;

    // 1. Change type and version
    nodeBlock = nodeBlock.replace(/type:\s*['"]@n8n\/n8n-nodes-langchain.agent['"]/, 'type: "@n8n/n8n-nodes-langchain.chainLlm"');
    nodeBlock = nodeBlock.replace(/version:\s*[\d.]+/, 'version: 1.4');

    // 2. Extract text (old user prompt/xml) config
    let textMatch = nodeBlock.match(/text:\s*(`[\s\S]*?`),[\r\n\s]+options/);
    if (!textMatch) textMatch = nodeBlock.match(/text:\s*(`[\s\S]*?`)/);

    let extractedTextValue = '';
    if (textMatch) {
        extractedTextValue = textMatch[1];
        nodeBlock = nodeBlock.replace(/text:\s*`[\s\S]*?`,?[\r\n\s]+/, '');
    }

    // 3. Extract systemMessage
    let sysMatch = nodeBlock.match(/systemMessage:\s*("[^"]+"|'[^']+'|`[\s\S]*?`)/);
    let extractedSysValue = '""';
    if (sysMatch) {
        extractedSysValue = sysMatch[1];
        // Clean up the options block entirely
        nodeBlock = nodeBlock.replace(/options:\s*\{[\s\S]*?systemMessage:[\s\S]*?\},?[\r\n\s]*/, '');
    }

    // 5. Convert old text (XML) into pseudo-JSON
    let cleanText = extractedTextValue;
    if (cleanText.startsWith('`')) cleanText = cleanText.substring(1);
    if (cleanText.endsWith('`')) cleanText = cleanText.substring(0, cleanText.length - 1);

    let newJsonPrompt = convertXmlToJsonObj(cleanText);

    // 6. Build the new parameters mapping for Chain LLM
    // Also change `promptType` to `"define"` since chains use double quotes for properties often
    let newProperties = `
        promptType: "define",
        hasOutputParser: false,
        text: ${extractedSysValue},
        prompt: \`${newJsonPrompt}\``;

    // Remove old promptType
    nodeBlock = nodeBlock.replace(/promptType:\s*['"]define['"],?[\r\n\s]+/, '');

    // Inject before the final closing brace of the config object
    let beforeClosingBrace = nodeBlock.lastIndexOf('}');
    nodeBlock = nodeBlock.substring(0, beforeClosingBrace) + newProperties + '\\n    ' + nodeBlock.substring(beforeClosingBrace);

    content = content.substring(0, startIdx) + nodeBlock + content.substring(endIdx);
    count++;
}

// We also need to fix the routing connections if we are no longer using agents, though `ai_languageModel` is the same connection for both basic LLM chain and agents.

fs.writeFileSync(workflowPath, content);
console.log('Converted ' + count + ' Agent nodes to Basic LLM Chains!');
