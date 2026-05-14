const fs = require('fs');
let c = fs.readFileSync('packages/projects/src/templates.ts', 'utf8');

c = c.replace(
  "`Use the emotional arc specified for that chapter as the internal journey.`;",
  "`Use the emotional arc specified for that chapter as the internal journey.`;\n\n" +
  "  const settingSeed =\n" +
  "    `Anchor this scene to ${chapterAnchor}. ` +\n" +
  "    `Consult the Chapter Outline in your context for Chapter ${chapterNum}: ` +\n" +
  "    `use that chapter\\'s POV character and the primary new location or environment they enter. ` +\n" +
  "    `Write the SETTING/EXPOSITION introduction — the character experiencing this space for the first time. ` +\n" +
  "    `Establish atmosphere purely through the character\\'s physical interaction with the environment.`;"
);

fs.writeFileSync('packages/projects/src/templates.ts', c);
