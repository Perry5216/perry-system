/**
 * @perry/projects — Template Registry
 *
 * Defines all project types and their step sequences. Each template
 * is a pure data structure — no logic, no side effects.
 *
 * Templates are the DNA of the pipeline. They specify:
 *   - What steps to run
 *   - In what order
 *   - What task type each step uses (for provider routing)
 *   - What prompt to send
 */

import type { ProjectStep, ProjectType, ProjectContext } from '@perry/core';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Template Definition
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export interface ProjectTemplate {
  type: ProjectType;
  name: string;
  description: string;
  buildSteps: (context: ProjectContext, title: string, description: string) => ProjectStep[];
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Helper
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function step(
  index: number,
  label: string,
  phase: string,
  taskType: string,
  prompt: string,
  opts?: { wordCountTarget?: number; chapterNumber?: number; segmentIndex?: number; totalSegments?: number },
): ProjectStep {
  // Limit to tasks that legitimately risk hitting the 8k token limit to prevent LLM hallucinating the footer
  const segmentableTypes = ['creative_writing', 'revision_execution'];

  return {
    id: `step-${index}`,
    label,
    phase,
    taskType,
    prompt,
    status: 'pending',
    wordCountTarget: opts?.wordCountTarget,
    chapterNumber: opts?.chapterNumber,
    segmentIndex: opts?.segmentIndex,
    totalSegments: opts?.totalSegments,
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Templates
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const bookPlanning: ProjectTemplate = {
  type: 'book-planning',
  name: 'Book Planning',
  description: 'Market analysis → premise → character bible → chapter outline',
  buildSteps: (ctx, title, description) => [
    step(1, 'Market & Genre Analysis', 'research', 'research',
      `Analyze the market positioning for: "${title}"\n\nDescription: ${description}\n\n` +
      `Provide: genre classification, 3-5 comparable titles, target audience, 3-5 market trends, ` +
      `relevant tropes and reader expectations. Be specific and concise.`),
    step(2, 'Develop Premise', 'premise', 'outline',
      `Based on the market analysis, develop a compelling premise for "${title}".\n\n` +
      `Include: core concept, central conflict, thematic statement, unique hook, ` +
      `stakes (personal/public/philosophical), and a one-paragraph elevator pitch.`),
    step(3, 'Faction Bible', 'bible', 'book_bible',
      `Based on the Premise for "${title}", define every major faction, organisation, or power group.\n\n` +
      `For EACH faction include:\n` +
      `- **Name & Alias**: official name + how they're known colloquially\n` +
      `- **Core Ideology**: what they believe and why (1-2 sentences)\n` +
      `- **Goal**: what they are actively working toward in this book\n` +
      `- **Resources & Power**: what gives them leverage (military, tech, information, numbers, territory)\n` +
      `- **Territory/Domain**: where they operate (physical locations, digital spaces, etc.)\n` +
      `- **Internal Culture**: hierarchy style (rigid military / democratic / cult-like / anarchic), recruitment, rituals\n` +
      `- **Public Perception**: how outsiders see them (feared? respected? unknown?)\n` +
      `- **Weakness/Vulnerability**: what could bring them down\n` +
      `- **Key Tension**: the internal disagreement or schism that threatens them from within\n\n` +
      `## INTER-FACTION RELATIONSHIPS (MANDATORY)\n` +
      `Create a relationship matrix showing how every faction relates to every other faction:\n` +
      `- Alliance / Rivalry / Cold War / Open Conflict / Mutual Ignorance / Exploitation\n` +
      `- One sentence explaining WHY they have this relationship\n\n` +
      `## FACTION ARCS\n` +
      `For each faction, describe their trajectory across this book:\n` +
      `- Where do they START (status quo)?\n` +
      `- What DISRUPTS them?\n` +
      `- Where do they END (transformed, destroyed, ascendant, fractured)?\n\n` +
      `This Faction Bible will be used to assign characters to factions in the Character Bible step.\n\n`),
    step(4, 'Character Bible', 'bible', 'book_bible',
      `Based on the Faction Bible, create detailed character profiles for "${title}".

` +
      `## CAST REQUIREMENTS (Multi-POV)
` +
      `### Tier 1 — POV Characters (5-7 characters, FULL profiles)
` +
      `These are the characters who will narrate chapters. Each needs: full name, role, faction, ` +
      `physical description (specific and visual), personality traits, detailed backstory, ` +
      `motivation (what they WANT vs what they NEED), character arc (beginning → end state), ` +
      `key relationships to OTHER POV characters, internal conflict, and voice/speech patterns.
` +
      `CRITICAL: Every major faction MUST have at least one POV character. ` +
      `POV characters should have CONFLICTING goals so chapters create natural tension.

` +
      `### Tier 2 — Key Supporting Cast (8-12 characters, INTERACTION profiles)
` +
      `These characters appear repeatedly but don't narrate. Each needs: name, role, faction, ` +
      `brief appearance, personality in 2-3 words, their relationship to 2+ POV characters, ` +
      `what they want, and how they complicate the plot. Include lieutenants, rivals, mentors, ` +
      `love interests, and betrayers.

` +
      `### Tier 3 — Named Minor Characters (4-6 characters, FUNCTION profiles)
` +
      `Characters who appear in 1-3 scenes with a specific function: informants, gatekeepers, ` +
      `victims, witnesses. Each needs: name, faction, function, and one memorable trait.

` +
      `## DIALOGUE FINGERPRINT (MANDATORY for Tier 1 and Tier 2)
` +
      `For each character you MUST also define:
` +
      `- **Contraction rate**: high ("can't", "won't", "I'm") / medium / low (formal speech)
` +
      `- **Reading level**: grade school / high school / academic / streetwise
` +
      `- **Verbal tics**: 2-3 pet phrases, filler words, or habitual expressions unique to them
` +
      `- **Sentence style**: fragments / run-ons / measured / clipped military / rambling
` +
      `- **Interruption style**: interrupts others / gets interrupted / neither / both
` +
      `- **Cognitive bias**: what do they notice first? What do they misread or ignore?

` +
      `## FORBIDDEN NAMES (MANDATORY)
` +
      `The following names are BANNED — they are overused AI defaults that immediately signal machine authorship. ` +
      `Do NOT use any of these names or close variants for any character:
` +
      `Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo
` +
      `Choose distinctive, era-appropriate names that feel authored, not generated.`),
    step(5, 'Voice Profile', 'bible', 'voice_profile',
      `Based on the Market & Genre Analysis, Faction Bible, and Character Bible for "${title}", ` +
      `generate a comprehensive Voice Profile that will govern the prose style of the entire novel.\n\n` +
      `## GENRE VOICE\n` +
      `- What narrative voice does this genre demand? (Conversational? Literary? Hardboiled? Lyrical?)\n` +
      `- What POV tense (past/present) best serves this story?\n` +
      `- What sentence rhythm defines the genre's best sellers? (Short punchy? Long flowing? Mixed?)\n\n` +
      `## PROSE TARGETS (provide specific numbers)\n` +
      `- Target average sentence length: [X] words\n` +
      `- Sentence length range: [min]-[max] words (std dev should be high for natural variation)\n` +
      `- Target dialogue-to-narrative ratio: [X]% dialogue\n` +
      `- Contraction rate in narrative: [X]% (higher = more casual)\n` +
      `- Adverb density target: below [X]%\n` +
      `- Paragraph length range: [X]-[Y] sentences\n\n` +
      `## VOICE SAMPLES\n` +
      `Write 3 SHORT sample passages (100-150 words each) that demonstrate the EXACT ` +
      `voice this novel should use. These samples will be injected into every chapter prompt ` +
      `as the style reference. Each sample should demonstrate:\n` +
      `1. A dialogue-heavy scene showing character voice differentiation\n` +
      `2. An action/tension scene showing pacing through sentence length variation\n` +
      `3. An introspective moment showing deep POV internal monologue\n\n` +
      `## ANTI-PATTERNS\n` +
      `List 10-15 specific prose patterns that would make this novel sound AI-generated:\n` +
      `- Overused transitional phrases to avoid\n` +
      `- Sentence structures that create monotony\n` +
      `- Emotional telling patterns specific to this genre\n` +
      `- Description clichés common in AI output for this genre\n\n` +
      `The output of this step will be used as the primary style guide for every chapter.\n\n`),
    step(6, 'Influence Map', 'bible', 'voice_profile',
      `Based on the Voice Profile for "${title}", create an Influence Map that anchors this pen name's style to 2-3 real-world author influences.\n\n` +
      `## PRIMARY INFLUENCES (2-3 authors)\n` +
      `For EACH influence, define:\n` +
      `- **Author Name**: The real author whose work this pen name echoes\n` +
      `- **What We Borrow**: 2-3 SPECIFIC techniques (not vague praise). Example: "McCarthy's lack of quotation marks" or "Gibson's brand-names-as-worldbuilding"\n` +
      `- **What We Reject**: 1-2 aspects of this author's style we deliberately avoid\n` +
      `- **Signature Technique**: The ONE habit from this author that becomes a core part of our pen name's DNA\n\n` +
      `## COMPOSITE VOICE STATEMENT\n` +
      `Write a single sentence that captures the fusion: "Writes like [Author A]'s [technique] meets [Author B]'s [technique], filtered through [unique twist]."\n\n` +
      `## INFLUENCE BOUNDARIES\n` +
      `List 3-5 authors this pen name must NEVER sound like, and why. These are the "anti-influences."\n\n`),
    step(7, 'Vocabulary Fingerprint', 'bible', 'voice_profile',
      `Based on the Voice Profile and Influence Map for "${title}", create a Vocabulary Fingerprint that defines this pen name's unique word-level identity.\n\n` +
      `## SIGNATURE WORDS (15-20 words)\n` +
      `Words this author gravitates toward unconsciously. Include:\n` +
      `- 5-7 sensory/texture words (e.g., "ceramic", "filament", "torque", "ratchet")\n` +
      `- 3-4 emotional/state words (e.g., "hollow", "taut", "static")\n` +
      `- 3-4 action verbs (e.g., "slot", "rack", "seal", "shunt")\n` +
      `- 2-3 transition/rhythm words (e.g., "somewhere", "nothing", "still")\n\n` +
      `## BANNED WORDS (15-20 words)\n` +
      `Words this author would NEVER use:\n` +
      `- 5-7 overused AI words (e.g., "delve", "tapestry", "vibrant", "nuanced", "testament")\n` +
      `- 5-7 purple prose markers (e.g., "beautiful", "stunning", "breathtaking", "magnificent")\n` +
      `- 3-5 genre cliches specific to this book's genre\n\n` +
      `## METAPHOR FAMILY\n` +
      `Define the metaphor domain this author draws from:\n` +
      `- **Primary metaphor source**: (mechanical? biological? geological? architectural? nautical?)\n` +
      `- **Secondary metaphor source**: (weather? music? combat? cooking?)\n` +
      `- **FORBIDDEN metaphor sources**: (dance? tapestry? symphony? painting?)\n` +
      `- Provide 5 example metaphors this author would use and 5 they would never use.\n\n`),
    step(8, 'Structural Habits', 'bible', 'voice_profile',
      `Based on the Voice Profile for "${title}", define the Structural Habits that make this pen name's chapter architecture distinctive.\n\n` +
      `## CHAPTER OPENINGS\n` +
      `How does this author start chapters? Pick ONE dominant pattern:\n` +
      `- Cold open mid-action (no establishing shot)\n` +
      `- Sensory anchor (one specific detail that grounds the scene)\n` +
      `- Dialogue hook (first line is spoken)\n` +
      `- Time/place stamp (clinical, factual)\n` +
      `- Internal thought (deep POV from sentence one)\n` +
      `Explain WHY this pattern fits the genre and provide 2 example opening lines.\n\n` +
      `## CHAPTER ENDINGS\n` +
      `How does this author close chapters? Pick ONE dominant pattern:\n` +
      `- Cliffhanger (mid-action cut)\n` +
      `- Revelation (new information that reframes everything)\n` +
      `- Emotional resonance (quiet moment that lingers)\n` +
      `- Mirror (echoes the opening image/line)\n` +
      `- Decision point (character commits to an irreversible choice)\n\n` +
      `## SCENE TRANSITIONS\n` +
      `- Does this author use section breaks (***) within chapters? How often?\n` +
      `- How are time skips handled? (Hard cut? Transitional sentence? White space?)\n` +
      `- How are location changes handled within a chapter?\n\n` +
      `## PACING ARCHITECTURE\n` +
      `- Scene-to-sequel ratio: what % of each chapter is active scene vs reflective sequel?\n` +
      `- Does this author front-load action or build slowly?\n` +
      `- How long is the average scene before a transition? (1 page? 3 pages? 5 pages?)\n` +
      `- How does this author handle exposition? (Woven into action? Dialogue? Brief narrative asides?)\n\n`),
    step(9, 'Dialogue Fingerprint', 'bible', 'voice_profile',
      `Based on the Character Bible and Voice Profile for "${title}", create a Dialogue Fingerprint that defines how conversation WORKS under this pen name.\n\n` +
      `## ATTRIBUTION STYLE\n` +
      `- Tag frequency: What % of dialogue lines get a tag? (every line? every 3rd? only when ambiguous?)\n` +
      `- Preferred tag word: "said" only? Mixed ("said/asked/whispered")? Action beats instead of tags?\n` +
      `- Adverb-modified tags: NEVER ("said quietly") or RARELY? Give the exact policy.\n` +
      `- Action beat style: before dialogue, after dialogue, or interrupting mid-sentence?\n\n` +
      `## CONVERSATION DYNAMICS\n` +
      `- Do characters interrupt each other? How often?\n` +
      `- Maximum unbroken speech: how many sentences can a character speak before an action beat or interruption?\n` +
      `- How is subtext handled? (Characters say the opposite of what they mean? Silence? Deflection?)\n` +
      `- How is exposition delivered in dialogue? (Characters explaining things they both know is FORBIDDEN)\n\n` +
      `## DIALOGUE RHYTHM SAMPLES\n` +
      `Write 2 short dialogue exchanges (5-8 lines each) that demonstrate:\n` +
      `1. A tense confrontation showing how characters talk PAST each other\n` +
      `2. An intimate/quiet exchange showing how vulnerability sounds in this pen name's voice\n\n` +
      `## DIALOGUE ANTI-PATTERNS\n` +
      `List 5 dialogue mistakes this pen name must NEVER make:\n` +
      `- Example: "As you know, Bob..." exposition dumps\n` +
      `- Example: Characters narrating their own emotions in speech\n` +
      `- Example: Every character sounding the same regardless of background\n\n`),
    step(10, 'Thematic Obsessions', 'bible', 'voice_profile',
      `Based on the Premise and Character Bible for "${title}", define the Thematic Obsessions that will recur across this pen name's entire body of work.\n\n` +
      `## CORE THEMES (2-3 themes)\n` +
      `For EACH theme:\n` +
      `- **Theme Statement**: A single sentence capturing the question this pen name keeps asking (e.g., "Does loyalty require self-destruction?")\n` +
      `- **How It Manifests**: How does this theme appear in THIS book? Which characters embody it?\n` +
      `- **The Pen Name's Position**: Does this author believe in redemption? Justice? Nihilism? What worldview bleeds through?\n` +
      `- **Recurring Motif**: A physical object, image, or action that symbolises this theme (e.g., locked doors, broken mirrors, empty chairs)\n\n` +
      `## THE SIGNATURE MOMENT\n` +
      `Every author has a type of scene they write better than anything else. Define this pen name's signature moment:\n` +
      `- What kind of scene does this author LIVE for? (The betrayal reveal? The quiet after violence? The impossible choice?)\n` +
      `- Write a 100-word sample of this moment at its best.\n\n` +
      `## READER RELATIONSHIP\n` +
      `- How much does this author trust the reader? (Heavy foreshadowing or subtle? Explain mechanics or let readers figure it out?)\n` +
      `- Does this author prioritise intellectual engagement or emotional gut-punch?\n` +
      `- What should the reader feel when they close the book? (Devastated? Hopeful? Unsettled? Satisfied?)\n\n`),
    step(11, 'World Building', 'bible', 'book_bible',
      `Build the world/setting for "${title}".\n\n` +
      `Include: physical setting(s), time period, social structures, rules/systems, ` +
      `atmosphere/mood, cultural details, technology/magic systems if applicable, ` +
      `and how the setting creates conflict. Specifically detail the territories, resources, and cultural influence of the major factions established in the Faction Bible.\n\n`),
    step(12, 'Subplots & Faction Arcs', 'outline', 'outline',
      `Map out the interconnecting subplots, B-Stories, and C-Stories for "${title}".\n\n` +
      `Ensure every major character from the Character Bible has a defined arc that is not wasted. ` +
      `Using the Faction Bible's inter-faction relationships and faction arcs, ` +
      `outline how their individual goals intersect, collide, or align over the course of the book.\n\n`),
    step(13, 'Chapter-by-Chapter Outline', 'outline', 'outline',
      `Create a detailed chapter-by-chapter outline for "${title}".\n\n` +
      `Target: ${ctx.includePrologue ? 'Prologue, ' : ''}${ctx.targetChapters || 25} chapters${ctx.includeEpilogue ? ', Epilogue' : ''} at ~${ctx.targetWordsPerChapter || 3000} words each.\n\n` +
      `For EACH section (including Prologue/Epilogue if applicable) include: chapter number/title, POV character, ` +
      `opening situation, key events, emotional arc, chapter-ending hook, ` +
      `and which plot threads advance.\n\n` +
      `CRITICAL: Ensure a balanced rotation of POV characters to build tension. Track the geography and timeline explicitly so characters do not teleport. Braiding: clearly indicate how each chapter advances the B-Stories and C-Stories established in the Subplots step.\n\n` +
      `MANDATORY FORMAT — each chapter MUST use this EXACT header structure (use numeric digits, NOT word numbers):\n` +
      `## Chapter 1: [Title]\n` +
      `**POV:** [Character Name]\n` +
      `**Opening:** [situation]\n` +
      `**Key Events:** [events]\n` +
      `**Emotional Arc:** [arc]\n` +
      `**Hook:** [hook]\n` +
      `**Plot Threads:** [threads]\n\n` +
      `Do NOT use word-numbers (e.g. "Chapter One"). Do NOT use tables. Do NOT use Roman numerals. ` +
      `Use "## Chapter 1:", "## Chapter 2:", etc. exactly. The downstream pipeline depends on this.\n\n` +
      `Generate ALL ${ctx.targetChapters || 25} chapters in one continuous response. If you run out of space, continue from where you stopped — do not restart.`),
    step(14, 'Tension Blueprint', 'outline', 'outline',
      `Based on the Chapter-by-Chapter Outline for "${title}", create a Tension Blueprint that maps the emotional intensity of every chapter.\n\n` +
      `For each chapter, assign:\n` +
      `- **Tension Target** (1-10 scale): How tense should this chapter FEEL to the reader?\n` +
      `- **Beat Type**: What structural beat does this chapter occupy? (Inciting Incident, Rising Action, Midpoint Reversal, Dark Night, Climax, Aftermath, Breathing Room, etc.)\n` +
      `- **Energy**: Rising / Falling / Peak / Decompression / Plateau\n` +
      `- **Pacing Note**: Should this chapter move FAST (short scenes, action, dialogue) or SLOW (introspection, atmosphere, world-building)?\n\n` +
      `Then identify:\n` +
      `- The 3-Act structure mapped to specific chapter ranges\n` +
      `- Any tension valleys (3+ consecutive chapters below 5/10) — these MUST be fixed\n` +
      `- Any missing beats (no midpoint? no all-is-lost moment?)\n` +
      `- The peak tension chapter (should be in the final 20% of the book)\n\n` +
      `Output as a Markdown table with columns: Chapter | Tension (1-10) | Beat Type | Energy | Pacing Note\n\n`),
    step(15, 'Foreshadowing & Payoff Map', 'outline', 'outline',
      `Based on the Chapter Outline and Tension Blueprint for "${title}", create a comprehensive Foreshadowing & Payoff Map.\n\n` +
      `Map EVERY setup/payoff pair in the novel:\n\n` +
      `For each seed:\n` +
      `- **Seed ID**: F-01, F-02, etc.\n` +
      `- **Plant Chapter**: Which chapter plants the seed?\n` +
      `- **Plant Description**: What exactly is the setup? (A detail noticed, a line of dialogue, an object introduced)\n` +
      `- **Payoff Chapter**: Which chapter pays it off?\n` +
      `- **Payoff Description**: How does the payoff land?\n` +
      `- **Type**: Chekhov's Gun / Character Revelation / Plot Twist / Thematic Echo / Red Herring\n\n` +
      `Requirements:\n` +
      `- Minimum 15-20 foreshadowing seeds across the novel\n` +
      `- Every major plot twist in the outline MUST have at least 2 seeds planted earlier\n` +
      `- At least 2-3 Red Herrings to keep the reader guessing\n` +
      `- No payoff chapter should be more than 10 chapters from its plant (or the reader forgets)\n` +
      `- Cross-reference with the Subplots step: every B/C-story thread should have setup-payoff tracking\n\n` +
      `Output as a Markdown table with columns: Seed ID | Plant Ch | Plant Description | Payoff Ch | Payoff Description | Type\n\n`),
    step(16, 'Scene-Level Breakdown', 'outline', 'outline',
      `Based on the Chapter Outline, Tension Blueprint, and Foreshadowing Map for "${title}", create a Scene-Level Breakdown for every chapter.\n\n` +
      `For each chapter, break it into 2-4 distinct scenes:\n\n` +
      `For each scene:\n` +
      `- **Scene Number & Name**: e.g., "Scene 1: The Briefing"\n` +
      `- **Word Budget**: How many words this scene should get (must sum to the chapter target of ~${ctx.targetWordsPerChapter || 3000})\n` +
      `- **Entry Point**: Where does the scene start? (In medias res? After a time skip? Continuation?)\n` +
      `- **Scene Goal**: What must this scene accomplish? (Plot advancement, character revelation, tension escalation, etc.)\n` +
      `- **Exit Point**: How does the scene end? (Scene break, cliffhanger, emotional beat, transition)\n` +
      `- **Foreshadowing**: Which seeds from the Foreshadowing Map are planted or paid off in this scene? (Reference by Seed ID)\n` +
      `- **Tension**: Should this scene's tension be above or below the chapter's target?\n\n` +
      `CRITICAL RULES:\n` +
      `- Every scene must accomplish at least 2 of: advance plot, reveal character, build world, escalate tension, explore theme\n` +
      `- No scene should exist purely for transition (walking, travelling, arriving)\n` +
      `- Chapter 1 MUST include an Opening Hook Strategy: specify the hook type (in medias res / mystery question / character voice / sensory immersion), the first-line concept, and the mystery question planted in the first 500 words\n` +
      `- The Prologue (if applicable) must specify its genre signal and thematic question\n` +
      `This output will be injected into every chapter prompt as the primary writing blueprint.`),
  ],
};


const novelPipeline: ProjectTemplate = {
  type: 'novel-pipeline',
  name: 'Novel Pipeline',
  description: 'Full pipeline: planning → writing → first revision pass',
  buildSteps: (ctx, title, description) => {
    const chapters = ctx.targetChapters || 25;
    const wordsPerChapter = ctx.targetWordsPerChapter || 3000;
    const steps: ProjectStep[] = [];
    let idx = 1;

    // Planning phase (skip if inheriting from a parent)
    if (!ctx.hasParent) {
      steps.push(step(idx++, 'Market & Genre Analysis', 'research', 'research',
        `Analyze the market positioning for: "${title}"\n\n${description}\n\n` +
        `Provide genre classification, 3-5 comparable titles, target audience, ` +
        `3-5 market trends, and relevant tropes. Be concise.`));
      steps.push(step(idx++, 'Develop Premise', 'premise', 'outline',
        `Develop a compelling premise for "${title}" based on the market analysis.\n\n` +
        `Include: core concept, central conflict, thematic statement, unique hook, ` +
        `stakes, and elevator pitch.`));
      steps.push(step(idx++, 'Faction Bible', 'bible', 'book_bible',
        `Based on the Premise for "${title}", define every major faction, organisation, or power group.\n\n` +
        `For EACH faction: Name & Alias, Core Ideology, Goal, Resources & Power, Territory/Domain, ` +
        `Internal Culture (hierarchy style), Public Perception, Weakness/Vulnerability, Key Internal Tension.\n\n` +
        `## INTER-FACTION RELATIONSHIPS (MANDATORY)\n` +
        `Create a relationship matrix: Alliance / Rivalry / Cold War / Open Conflict / Mutual Ignorance / Exploitation.\n` +
        `One sentence per pair explaining WHY.\n\n` +
        `## FACTION ARCS\n` +
        `For each faction: Where they START → What DISRUPTS them → Where they END.\n\n` +
        `This will be used to assign characters in the Character Bible step.\n\n`));
      steps.push(step(idx++, 'Character Bible', 'bible', 'book_bible',
        `Based on the Faction Bible, create detailed character profiles for "${title}".

` +
        `## CAST REQUIREMENTS (Multi-POV)
` +
        `### Tier 1 — POV Characters (5-7 characters, FULL profiles)
` +
        `Characters who narrate chapters. Each needs: name, role, faction, physical description, ` +
        `personality, detailed backstory, motivation (WANT vs NEED), arc (beginning → end), ` +
        `relationships to other POV characters, internal conflict, and voice.
` +
        `Every major faction MUST have at least one POV character. POV characters should have CONFLICTING goals.

` +
        `### Tier 2 — Key Supporting Cast (8-12 characters, INTERACTION profiles)
` +
        `Recurring non-POV characters. Each needs: name, role, faction, appearance, personality, ` +
        `relationships to 2+ POV characters, what they want, how they complicate the plot.

` +
        `### Tier 3 — Named Minor Characters (4-6 characters, FUNCTION profiles)
` +
        `Characters in 1-3 scenes. Each needs: name, faction, function, one memorable trait.

` +
        `## DIALOGUE FINGERPRINT (MANDATORY for Tier 1 and Tier 2)
` +
        `For each character define: contraction rate (high/medium/low), reading level, ` +
        `2-3 verbal tics/pet phrases, sentence style (fragments/run-ons/measured/clipped), ` +
        `interruption style, and cognitive bias (what they notice first, what they misread).

` +
        `## FORBIDDEN NAMES (MANDATORY)
` +
        `The following names are BANNED — they are overused AI defaults that immediately signal machine authorship. ` +
        `Do NOT use any of these names or close variants for any character:
` +
        `Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo
` +
        `Choose distinctive, era-appropriate names that feel authored, not generated.`));
      steps.push(step(idx++, 'Voice Profile', 'bible', 'voice_profile',
        `Based on the Market & Genre Analysis and Character Bible for "${title}", ` +
        `generate a comprehensive Voice Profile for the novel's prose style.\n\n` +
        `Include:\n` +
        `1. GENRE VOICE — narrative voice, POV tense, sentence rhythm\n` +
        `2. PROSE TARGETS — avg sentence length, sentence range, dialogue ratio, contraction rate, adverb density target\n` +
        `3. VOICE SAMPLES — write 3 sample passages (100-150 words each) demonstrating the exact voice: ` +
        `a dialogue scene, an action scene, and an introspective moment\n` +
        `4. ANTI-PATTERNS — 10-15 specific prose patterns to avoid that would make the novel sound AI-generated\n\n` +
        `This output will be injected into every chapter prompt as the primary style reference.\n\n`));
      steps.push(step(idx++, 'World Building', 'bible', 'book_bible',
        `Build the world/setting for "${title}". Include: physical settings, ` +
        `time period, social structures, rules, atmosphere, cultural details, ` +
        `and specifically expand on the territories, resources, and influence of the major factions.\n\n`));
      steps.push(step(idx++, 'Subplots & Faction Arcs', 'outline', 'outline',
        `Map out the interconnecting subplots, B-Stories, and C-Stories for "${title}". ` +
        `Ensure every major character has a defined arc that is not wasted. ` +
        `Outline how their individual faction goals intersect over the course of the book.\n\n`));
      steps.push(step(idx++, 'Chapter Outline', 'outline', 'outline',
        `Create a chapter-by-chapter outline for "${title}".\n` +
        `Target: ${ctx.includePrologue ? 'Prologue, ' : ''}${chapters} chapters${ctx.includeEpilogue ? ', Epilogue' : ''} Ã— ${wordsPerChapter} words.\n` +
        `For EACH section (including Prologue/Epilogue if applicable): title, POV, opening, key events, emotional arc, ending hook.\n` +
        `CRITICAL: Rotate POVs to build tension, explicitly track geography/timelines, and weave in the established subplots.\n\n`));
      steps.push(step(idx++, 'Tension Blueprint', 'outline', 'outline',
        `Based on the Chapter Outline for "${title}", create a Tension Blueprint.\n\n` +
        `For each chapter assign:\n` +
        `- Tension Target (1-10): How tense should it feel?\n` +
        `- Beat Type: Inciting Incident / Rising Action / Midpoint / Dark Night / Climax / Aftermath / Breathing Room\n` +
        `- Energy: Rising / Falling / Peak / Decompression / Plateau\n` +
        `- Pacing Note: FAST (action, dialogue) or SLOW (introspection, atmosphere)\n\n` +
        `Flag: tension valleys (3+ chapters below 5/10), missing structural beats, and whether the peak is in the final 20%.\n` +
        `Output as a Markdown table: Chapter | Tension (1-10) | Beat Type | Energy | Pacing Note\n\n`));
      steps.push(step(idx++, 'Foreshadowing & Payoff Map', 'outline', 'outline',
        `Based on the Chapter Outline and Tension Blueprint for "${title}", map every setup/payoff pair.\n\n` +
        `For each seed: Seed ID (F-01, etc.), Plant Chapter, Plant Description, Payoff Chapter, Payoff Description, Type (Chekhov's Gun / Character Revelation / Plot Twist / Thematic Echo / Red Herring).\n\n` +
        `Requirements:\n` +
        `- Minimum 15-20 seeds\n` +
        `- Every major twist needs 2+ seeds planted earlier\n` +
        `- 2-3 Red Herrings\n` +
        `- No payoff more than 10 chapters from its plant\n\n` +
        `Output as a Markdown table: Seed ID | Plant Ch | Plant Description | Payoff Ch | Payoff Description | Type\n\n`));
      steps.push(step(idx++, 'Scene-Level Breakdown', 'outline', 'outline',
        `Based on the Chapter Outline, Tension Blueprint, and Foreshadowing Map for "${title}", create a Scene-Level Breakdown.\n\n` +
        `For each chapter, break into 2-4 scenes with: Scene Name, Word Budget (sum to ~${wordsPerChapter}), Entry Point, Scene Goal (must accomplish 2+ of: advance plot, reveal character, build world, escalate tension, explore theme), Exit Point, Foreshadowing seed IDs planted/paid off, Tension relative to chapter target.\n\n` +
        `MANDATORY RULE: The POV character for each scene MUST exactly match the POV character assigned to that chapter in the Chapter Outline. Do NOT change or contradict the Chapter Outline's POV.\n\n` +
        `Chapter 1 must include Opening Hook Strategy: hook type, first-line concept, mystery question in first 500 words.\n` +
        `No purely transitional scenes (walking, arriving, eating). This is the primary writing blueprint.`));
    }

    // MANDATORY SYSTEM SETUP (Runs regardless of parent inheritance)
    steps.push(step(idx++, 'Stat System Definition', 'bible', 'book_bible',
      `Based on the Character Bible, World Building, and Foreshadowing Map for "${title}", define the Live Tracking System.\n\n` +
      `Your task is to generate exactly 5 sections (A, B, C, D, E) containing markdown tables.\n\n` +
      `## A. Character Stats (4-6 numerical stats, scale 1-100)\n` +
      `Define the stats, what they represent, and starting values for each major character.\n` +
      `Examples: Sanity, Processing Power, Faction Influence, Wealth, Morality, Trust Level, etc.\n` +
      `OUTPUT FORMAT (Must be a Markdown Table):\n` +
      `| Character | Stat Name | Starting Value (1-100) | Description |\n\n` +
      `### Narrative Thresholds (CRITICAL)\n` +
      `For EVERY stat defined above, you MUST provide the following format so the AI knows HOW to write the character at their current stat level:\n` +
      `**[Stat Name] Thresholds:**\n` +
      `- **81-100 (Peak)**: How does this character act/think/speak when this stat is maxed? (e.g., Sanity 95 = calm, analytical, long measured sentences)\n` +
      `- **51-80 (Stable)**: Normal behaviour baseline\n` +
      `- **21-50 (Stressed)**: How does prose shift? (e.g., Sanity 35 = paranoid asides, shorter sentences, misreading social cues)\n` +
      `- **1-20 (Critical)**: What breaks? (e.g., Sanity 12 = fragmented internal monologue, hallucinated sensory details, unreliable narration)\n\n` +
      `## B. Relationship Dynamics Matrix\n` +
      `For each major character that interacts significantly with another major character, define their relationship.\n` +
      `OUTPUT FORMAT (Must be an exact 6-column Markdown Table. You MUST separate the characters into two columns):\n` +
      `| First Character | Second Character | Starting Dynamic | Intensity (1-10) | Trajectory (end-of-book goal) | Pressure Point |\n` +
      `|---|---|---|---|---|---|\n` +
      `| Kael | Juno | Uneasy Alliance | 6 | Eventual trust | Faction loyalties |\n\n` +
      `Dynamic types: trust / rivalry / mentor-student / uneasy alliance / romantic tension / dependency / antagonism / loyalty\n\n` +
      `## C. Faction Reputation Tracker\n` +
      `For each major character, define their STARTING REPUTATION with each faction (1-10 scale):\n` +
      `- **1-2 (Hostile)**: Kill/capture on sight. Faction members will be aggressive, deceptive, or flee.\n` +
      `- **3-4 (Distrusted)**: Suspicion, surveillance, denied access. Dialogue will be guarded, evasive.\n` +
      `- **5-6 (Neutral)**: No strong feeling. Transactional interactions only.\n` +
      `- **7-8 (Respected)**: Welcome, cooperative. Will share information and resources.\n` +
      `- **9-10 (Revered)**: Loyalty, deference. Members may sacrifice for this character.\n` +
      `Output: Character | Faction | Starting Reputation (1-10) | Label | Reason\n` +
      `These reputation levels will be injected into writing prompts so faction NPCs react appropriately.\n\n` +
      `## D. Foreshadowing Ledger\n` +
      `Create a Markdown table tracking the Foreshadowing & Payoff Map based on the context.\n` +
      `OUTPUT FORMAT: | Seed ID | Plant Description | Payoff Description |\n` +
      `CRITICAL INSTRUCTION: You must include every single seed. Do not drop any.\n\n` +
      `## E. Subplot Progress Tracker\n` +
      `Create a Markdown table listing every subplot from the context.\n` +
      `OUTPUT FORMAT: | Subplot Name | Status | Notes |\n` +
      `CRITICAL INSTRUCTION: Do NOT leave any subplots out. You must list them all.\n\n` +
      `The per-chapter Live Stat Update will track all five sections (A-E) and generate NARRATIVE DIRECTIVES — specific prose instructions for the next chapter based on current stat levels and faction reputation.\n\n`));

    if (ctx.includePrologue) {
      const actualWords = 1500; // Prologues are capped at 1500 to prevent structural looping and scene padding
      // Raise the split threshold — the smart continuation system handles word count
      // overflow within a single step via Ollama API continuation. Splitting into parts
      // causes pacing problems (each part becomes a mini-arc). Only split if the chapter
      // genuinely exceeds what a single coherent generation can cover (~3000 words).
      const segments = Math.max(1, Math.ceil(actualWords / 3000));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `Prologue — Part ${s}` : 'Prologue';
        const isFirstSeg = s === 1;
        const isLastSeg = s === segments;
        const continuationBlock = !isFirstSeg
          ? `CONTINUATION RULES (MANDATORY):\n` +
            `- You MUST continue the narrative EXACTLY where Part ${s - 1} left off.\n` +
            `- The Preceding Text context shows you the last 250 words of Part ${s - 1}. Pick up mid-scene, mid-paragraph if necessary.\n` +
            `- Do NOT restart the prologue. Do NOT re-introduce characters or settings already established.\n` +
            `- Do NOT repeat any prose from previous parts.\n\n`
          : '';
        steps.push(step(idx++, segName, 'writing', 'creative_writing',
          (isFirstSeg
            ? `Write the Prologue for "${title}" based on the premise and world building.\n\n`
            : `CONTINUE writing the Prologue for "${title}". This is Part ${s} of ${segments}.\n\n` + continuationBlock) +
          `Requirements:\n` +
          `- Target word count: ${wordsPerSegment} words. ABSOLUTE HARD LIMIT: Do NOT exceed ${wordsPerSegment + 100} words. Stop when you reach the target.\n` +
          (segments > 1 ? `- You are writing Part ${s} of ${segments}. Write fully immersive prose for THIS segment only.\n` : '') +
          (isFirstSeg
            ? `- SINGLE ARC MANDATE: Write ONE complete dramatic scene with a clear opening, rising tension, and a closing hook. Do NOT start a second scene or second dramatic cycle once you have landed on the hook beat.\n`
            : '') +
          `- Set the tone, establish the world, and plant ONE central mystery or unresolved tension.\n` +
          `- ANTI-LOOP RULE (CRITICAL): Do NOT restart the emotional or dramatic arc mid-way through. If you have already shown a character making a difficult choice, reaching a realisation, or receiving a revelation, DO NOT then show them receiving another revelation or making another difficult choice. One arc. One landing. Stop.\n` +
          `- NO EXPOSITION CHARACTERS: Do NOT introduce a mysterious figure, stranger, or disembodied voice whose only function is to deliver plot information to the POV character (e.g. "Find the MacGuffin", "The real enemy is X"). All world information must emerge from the POV character's own actions, observations, and decisions.\n` +
          `- Write complete, immersive prose — not summary.\n` +
          `- SCENE DIVERSITY: Include at least TWO of: dialogue exchange, action/movement, environmental description, internal monologue. Do NOT write an entire prologue as unbroken interior monologue.\n` +
          `- PUNCTUATION: Em dashes (—) are PROHIBITED except for sharp interruptions. Maximum 1 per 500 words. Two em dashes in the same sentence is a HARD FAILURE.\n` +
          (isLastSeg
            ? `- End on a specific, concrete image or action that functions as a hook — NOT a summary statement or thematic declaration. The reader should feel the ground shift, not be told it shifted.\n\n`
            : `- End mid-flow so the next part can continue seamlessly.\n\n`),
          { wordCountTarget: wordsPerSegment, chapterNumber: 0, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, 'Prologue — Compile Draft', 'writing', 'draft_compile',
          `Mechanical compilation of all drafted segments for the Prologue.`,
          { chapterNumber: 0, totalSegments: segments }));
      }

      steps.push(step(idx++, `Prologue — POV Check`, 'analysis', 'pov_check',
        `Perform a comprehensive narrative quality analysis of the Prologue of "${title}".\n\n` +
        `## 1. POV Analysis\n` +
        `- Which character's POV was actually used in this chapter?\n` +
        `- Does it match the POV character specified in the Chapter Outline?\n` +
        `- Is the Deep POV consistent — does every description, internal thought, and observation reflect ONLY what this character would notice/know?\n\n` +
        `## 2. Pacing & Plot Advancement\n` +
        `- Does the chapter spend its word count wisely, or is it padded with filler?\n` +
        `- Does the plot ACTUALLY advance, or is it all internal monologue and world-building?\n` +
        `- Are events happening, or is the character just thinking/walking/observing?\n\n` +
        `## 3. Plot Thread Tracking\n` +
        `- Which plot threads from the Chapter Outline were advanced in this chapter?\n` +
        `- Which B-story or C-story threads were woven in?\n` +
        `- Were any threads that SHOULD have been addressed (per the outline) completely ignored?\n\n` +
        `## 4. Chapter Hook\n` +
        `- Does the chapter end on a genuine cliffhanger, revelation, or tension point?\n` +
        `- Would a reader feel compelled to turn the page, or does it fizzle?\n\n` +
        `## 5. Prose Quality\n` +
        `- Identify any "Show vs Tell" violations where the text TELLS the reader about emotions instead of SHOWING them through action, dialogue, or sensation.\n` +
        `- List any filter words found (felt, saw, noticed, realized, seemed, wondered, watched, heard, knew, thought, decided). Quote the exact sentence for each.\n\n` +
        `## 6. Trope Execution\n` +
        `- Which genre tropes identified in the Market & Genre Analysis are being actively deployed or subverted in this chapter?\n` +
        `- Are any tropes being executed too literally (cliché) rather than with a fresh twist?\n` +
        `- Are expected reader payoffs from established tropes being set up or delivered?\n\n` +
        `## 7. AI-Ism Check\n` +
        `- Identify any "Rule of Three" (Tricolon) patterns (e.g., "He was X. He was Y. He was Z.").\n` +
        `- Identify repetitive or explicit dialogue attribution (flag if every line has "said/replied" instead of action beats).\n` +
        `- Identify formulaic fragments for effect ("He gasped. A wet sound.").\n` +
        `- Identify cliché similes ("heart hammering like a trapped bird").\n` +
        `- Identify Nominalization (excessive use of -tion, -ment, -ness words instead of active verbs).\n` +
        `- Identify Present Participle overuse (starting multiple sentences with -ing clauses).\n` +
        `- Identify Adjective Stacking (e.g., "the dark, oppressive, shimmering room").\n\n` +
        `OUTPUT FORMAT (you MUST follow this exactly):\n` +
        `- **POV Character**: [name]\n` +
        `- **Outline Match**: YES/NO\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10] (10 = every scene earns its word count, 1 = nothing happens)\n` +
        `- **Hook Score**: [1-10] (10 = unputdownable cliffhanger, 1 = flat ending)\n` +
        `- **Plot Threads Advanced**: [list which outline threads moved forward]\n` +
        `- **Plot Threads Stalled**: [list threads that should have advanced but didn't, or "None"]\n` +
        `- **Tropes Deployed**: [list tropes actively used or subverted in this chapter, or "None"]\n` +
        `- **Trope Warnings**: [flag any tropes executed as cliché without a fresh angle, or "None"]\n` +
        `- **Filter Words Found**: [list exact sentences containing filter words, or "None"]\n` +
        `- **Show vs Tell Violations**: [list passages that tell emotions, or "None"]\n` +
        `- **AI-Isms Found**: [list any Rule of Three, repetitive dialogue tags, formulaic fragments, or cliché similes, or "None"]\n` +
        `- **Repetition Audit**: [list any phrase, image, or motif that appears 3+ times in the chapter. Quote the repeated phrase and count. Flag as CRITICAL if 5+. Or "None"]\n` +
        `- **Em Dash Count**: [total count of em dashes (—) in the chapter. Flag as EXCESSIVE if more than 6 per 1000 words]\n` +
        `- **Issues**: [list any POV breaks, head-hopping, or other problems]\n- **Verdict**: PASS / REVISE / REWRITE`,
        { chapterNumber: 0 }));

      steps.push(step(idx++, 'Prologue — Live Stat Update', 'analysis', 'stat_update',
        `Based on the events of the Prologue, perform a comprehensive Live Tracking Update.\n\n` +
        `## A. Character Stats\n` +
        `Update the stats (1-100 scale) for all major characters involved.\n` +
        `Output: Character Name | Stat Name | Old Value | New Value | Justification\n\n` +
        `## B. Faction Reputation Update (ONLY factions involved in the Prologue)\n` +
        `Update reputation ONLY where a character's actions in the Prologue would shift a faction's view of them.\n` +
        `Output: Character | Faction | Old Rep | New Rep | Label (Hostile/Distrusted/Neutral/Respected/Revered) | Trigger Event\n` +
        `âš ï¸ Flag any reputation that crossed a threshold boundary.\n\n` +
        `## C. Foreshadowing Ledger\n` +
        `Cross-reference the Foreshadowing & Payoff Map. Which seeds were PLANTED in the Prologue? Which were PAID OFF?\n` +
        `Output: Seed ID | Status (PLANTED / PAID OFF / NOT YET) | Notes\n\n` +
        `## D. Subplot Tracker\n` +
        `Which subplots ADVANCED in the Prologue? Which were DORMANT?\n` +
        `Output: Subplot | Status (ADVANCED / DORMANT) | Notes\n` +
        `Flag any subplot dormant for 3+ consecutive chapters as âš ï¸ AT RISK.\n\n` +
        `## E. Tension Check\n` +
        `What was the ACTUAL tension level of the Prologue as written, compared to the Tension Blueprint's target?\n` +
        `Output: Target Tension | Actual Tension | Beat Type Match (YES/NO) | Notes\n\n` +
        `## F. Relationship Dynamics (ONLY pairs who interacted in the Prologue)\n` +
        `Update ONLY relationship pairs where both characters appeared or interacted.\n` +
        `Output: Pair | Dynamic | Intensity Change | Key Moment\n\n` +
        `## G. NARRATIVE DIRECTIVES (SCOPED to Chapter 1 ONLY)\n` +
        `Consult the Chapter Outline to determine WHO is the POV character and which supporting cast appear in Chapter 1.\n` +
        `Generate directives ONLY for those characters — do NOT include characters who won't appear.\n\n` +
        `For the Chapter 1 POV character:\n` +
        `- State their current stat levels and threshold band (Peak/Stable/Stressed/Critical)\n` +
        `- Describe how their internal monologue should sound at these levels\n` +
        `- Note relationship tensions with other characters IN Chapter 1\n` +
        `- Flag if any stat is near a threshold boundary\n\n` +
        `For each SUPPORTING character appearing in Chapter 1:\n` +
        `- One-line stat summary and current emotional posture\n` +
        `- How they should behave toward the POV character based on relationship dynamics`,
        { chapterNumber: 0 }));
    }

    // Writing phase — one step per chapter
    for (let ch = 1; ch <= chapters; ch++) {
      const actualWords = ctx.chapterWordCounts?.[ch] || wordsPerChapter;
      // Raise the split threshold — the smart continuation system handles word count
      // overflow via Ollama continuation API. Splitting into parts causes pacing problems.
      // Only split if the chapter genuinely exceeds ~3000 words.
      const segments = Math.max(1, Math.ceil(actualWords / 3000));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `Chapter ${ch} — Part ${s}` : `Chapter ${ch}`;
        const isFirstSeg = s === 1;
        const isLastSeg = s === segments;
        const continuationBlock = !isFirstSeg
          ? `CONTINUATION RULES (MANDATORY):\n` +
            `- You MUST continue the narrative EXACTLY where Part ${s - 1} left off.\n` +
            `- The Preceding Text context shows you the last 250 words of Part ${s - 1}. Pick up mid-scene, mid-paragraph if necessary.\n` +
            `- Do NOT restart the chapter. Do NOT re-introduce characters or settings already established in earlier parts.\n` +
            `- Do NOT repeat any prose from previous parts.\n\n`
          : '';
        // Calculate which scenes belong to this segment (approximate split)
        const sceneGuide = segments > 1
          ? `- SCENE SCOPE: Consult the Scene-Level Breakdown for Chapter ${ch}. You are covering approximately scenes ${Math.ceil((s - 1) * (4 / segments)) + 1}-${Math.ceil(s * (4 / segments))} of the chapter's outline.\n`
          : '';
        steps.push(step(idx++, segName, 'writing', 'creative_writing',
          (isFirstSeg
            ? `Write the beginning of Chapter ${ch} of "${title}" based on the Scene-Level Breakdown.\n\n`
            : `CONTINUE writing Chapter ${ch} of "${title}". This is Part ${s} of ${segments}.\n\n` + continuationBlock) +
          `Requirements:\n` +
          `- Follow the outline and scene budget exactly.\n` +
          `- Target word count: ${wordsPerSegment} words. HARD LIMIT: Do NOT exceed ${wordsPerSegment + 200} words.\n` +
          (segments > 1 ? (() => {
            if (isFirstSeg) {
              return `- ARC ROLE (Part ${s} of ${segments}): ESTABLISHMENT. Introduce the scene, ground the reader in the POV character's environment and mindset. Build tension SLOWLY — do NOT resolve anything. End on rising action, not a resolution.\n`;
            } else if (isLastSeg) {
              return `- ARC ROLE (Part ${s} of ${segments}): CLIMAX & HOOK. This is where the chapter's primary tension peaks. Give the climax SPACE — do not rush it. The resolution should feel earned, not compressed. End on a hook that propels the reader into the next chapter.\n`;
            } else {
              return `- ARC ROLE (Part ${s} of ${segments}): ESCALATION. Deepen the conflict, raise the stakes, introduce complications. Do NOT resolve the primary tension — that is reserved for Part ${segments}. End on a rising beat, not a conclusion.\n`;
            }
          })() : 
            `- PACE AND BREATHE: Do not rush through the outline beats. Expand the moment. Give interactions space to breathe. Use environmental storytelling to anchor the reader. When something important happens, SLOW DOWN the narrative time.\n` +
            `- SHOW, DON'T TELL: Do not summarize emotions or plot points. Root every realization in physical sensations, micro-expressions, and specific, concrete actions.\n` +
            `- SENSORY RICHNESS: Every scene must ground the reader in at least three senses (sight, sound, smell, texture, temperature). Avoid generic descriptions; use specific, evocative details that reflect the POV character's unique worldview.\n`
          ) +
          sceneGuide +
          `- Write complete, immersive prose.\n` +
          (isLastSeg ? `- End with a compelling chapter hook.\n` : `- Do NOT resolve the chapter's central conflict. End mid-flow so Part ${s + 1} can continue seamlessly.\n`) +
          `- Stay consistent with the character bible and world building.\n` +
          `- USE DEEP POV: The narrative voice, descriptions, and internal monologue must deeply reflect the current POV character's specific biases, background, and faction allegiance.\n` +
          `- SCENE DIVERSITY: Vary the narrative mode. Include at least TWO of: dialogue exchange, action/movement, environmental description, internal monologue. Do NOT write an entire segment as a single unbroken interior monologue.\n` +
          `- ANTI-FILLER MANDATE: Do NOT pad the chapter with endless internal monologue, brooding, or mundane transitions (e.g., walking down hallways). If you need to hit the word count target, expand the DIALOGUE, deepen the CONFLICT, and show ACTION. Make events happen. Every single paragraph must advance the plot, tension, or a relationship.\n` +
          `- PUNCTUATION: Em dashes (—) are PROHIBITED except for sharp interruptions. Maximum 1 per 500 words. Use commas, semicolons, colons, or period breaks instead. Two em dashes in the same sentence is a HARD FAILURE.\n\n`,

          { wordCountTarget: wordsPerSegment, chapterNumber: ch, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, `Chapter ${ch} — Compile Draft`, 'writing', 'draft_compile',
          `Mechanical compilation of all drafted segments for Chapter ${ch}.`,
          { chapterNumber: ch, totalSegments: segments }));
      }

      // POV & Narrative Quality Gate — comprehensive per-chapter analysis
      steps.push(step(idx++, `Chapter ${ch} — POV Check`, 'analysis', 'pov_check',
        `Perform a comprehensive narrative quality analysis of Chapter ${ch} of "${title}".\n\n` +
        `## 1. POV Analysis\n` +
        `- Which character's POV was actually used in this chapter?\n` +
        `- Does it match the POV character specified in the Chapter Outline?\n` +
        `- Is the Deep POV consistent — does every description, internal thought, and observation reflect ONLY what this character would notice/know?\n\n` +
        `## 2. Pacing & Plot Advancement\n` +
        `- Does the chapter spend its word count wisely, or is it padded with filler?\n` +
        `- Does the plot ACTUALLY advance, or is it all internal monologue and world-building?\n` +
        `- Are events happening, or is the character just thinking/walking/observing?\n\n` +
        `## 3. Plot Thread Tracking\n` +
        `- Which plot threads from the Chapter Outline were advanced in this chapter?\n` +
        `- Which B-story or C-story threads were woven in?\n` +
        `- Were any threads that SHOULD have been addressed (per the outline) completely ignored?\n\n` +
        `## 4. Chapter Hook\n` +
        `- Does the chapter end on a genuine cliffhanger, revelation, or tension point?\n` +
        `- Would a reader feel compelled to turn the page, or does it fizzle?\n\n` +
        `## 5. Prose Quality\n` +
        `- Identify any "Show vs Tell" violations where the text TELLS the reader about emotions instead of SHOWING them through action, dialogue, or sensation.\n` +
        `- List any filter words found (felt, saw, noticed, realized, seemed, wondered, watched, heard, knew, thought, decided). Quote the exact sentence for each.\n\n` +
        `## 6. Trope Execution\n` +
        `- Which genre tropes identified in the Market & Genre Analysis are being actively deployed or subverted in this chapter?\n` +
        `- Are any tropes being executed too literally (cliché) rather than with a fresh twist?\n` +
        `- Are expected reader payoffs from established tropes being set up or delivered?\n\n` +
        `## 7. AI-Ism Check\n` +
        `- Identify any "Rule of Three" (Tricolon) patterns (e.g., "He was X. He was Y. He was Z.").\n` +
        `- Identify repetitive or explicit dialogue attribution (flag if every line has "said/replied" instead of action beats).\n` +
        `- Identify formulaic fragments for effect ("He gasped. A wet sound.").\n` +
        `- Identify cliché similes ("heart hammering like a trapped bird").\n` +
        `- Identify Nominalization (excessive use of -tion, -ment, -ness words instead of active verbs).\n` +
        `- Identify Present Participle overuse (starting multiple sentences with -ing clauses).\n` +
        `- Identify Adjective Stacking (e.g., "the dark, oppressive, shimmering room").\n\n` +
        `OUTPUT FORMAT (you MUST follow this exactly):\n` +
        `- **POV Character**: [name]\n` +
        `- **Outline Match**: YES/NO\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10] (10 = every scene earns its word count, 1 = nothing happens)\n` +
        `- **Hook Score**: [1-10] (10 = unputdownable cliffhanger, 1 = flat ending)\n` +
        `- **Plot Threads Advanced**: [list which outline threads moved forward]\n` +
        `- **Plot Threads Stalled**: [list threads that should have advanced but didn't, or "None"]\n` +
        `- **Tropes Deployed**: [list tropes actively used or subverted in this chapter, or "None"]\n` +
        `- **Trope Warnings**: [flag any tropes executed as cliché without a fresh angle, or "None"]\n` +
        `- **Filter Words Found**: [list exact sentences containing filter words, or "None"]\n` +
        `- **Show vs Tell Violations**: [list passages that tell emotions, or "None"]\n` +
        `- **AI-Isms Found**: [list any Rule of Three, repetitive dialogue tags, formulaic fragments, or cliché similes, or "None"]\n` +
        `- **Repetition Audit**: [list any phrase, image, or motif that appears 3+ times in the chapter. Quote the repeated phrase and count. Flag as CRITICAL if 5+. Or "None"]\n` +
        `- **Em Dash Count**: [total count of em dashes (—) in the chapter. Flag as EXCESSIVE if more than 6 per 1000 words]\n` +
        `- **Issues**: [list any POV breaks, head-hopping, or other problems]\n- **Verdict**: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      steps.push(step(idx++, `Chapter ${ch} — Live Stat Update`, 'analysis', 'stat_update',
        `Based on the events of Chapter ${ch}, perform a comprehensive Live Tracking Update.\n\n` +
        `## A. Character Stats (ONLY characters who APPEARED in Chapter ${ch})\n` +
        `Update stats ONLY for characters who physically appeared, were referenced in dialogue, or whose situation changed off-screen in this chapter. Do NOT include characters who did not appear — their stats are unchanged.\n` +
        `Output: Character Name | Stat Name | Old Value | New Value | Justification\n\n` +
        `## B. Faction Reputation Update (ONLY factions involved in Chapter ${ch})\n` +
        `Update reputation ONLY where a character's actions in this chapter would shift a faction's view of them.\n` +
        `Output: Character | Faction | Old Rep | New Rep | Label (Hostile/Distrusted/Neutral/Respected/Revered) | Trigger Event\n` +
        `âš ï¸ Flag any reputation that crossed a threshold boundary (e.g., Neutral→Distrusted) — this changes how faction members will behave.\n\n` +
        `## C. Foreshadowing Ledger\n` +
        `Cross-reference the Foreshadowing & Payoff Map. Which seeds from the map were PLANTED or PAID OFF in Chapter ${ch}?\n` +
        `- If a seed was DUE for planting in this chapter but was MISSED, flag it as âš ï¸ MISSED PLANT\n` +
        `- If a seed was DUE for payoff in this chapter but was NOT delivered, flag it as âš ï¸ MISSED PAYOFF\n` +
        `Output: Seed ID | Expected Action | Actual Status | Notes\n\n` +
        `## D. Subplot Tracker\n` +
        `Which subplots ADVANCED in Chapter ${ch}? Which were DORMANT?\n` +
        `Output: Subplot | Status (ADVANCED / DORMANT) | Consecutive Dormant Count | Notes\n` +
        `âš ï¸ Flag any subplot dormant for 3+ consecutive chapters as AT RISK of being a dropped thread.\n\n` +
        `## E. Tension Check\n` +
        `What was the ACTUAL tension level of Chapter ${ch} as written, compared to the Tension Blueprint's target?\n` +
        `Output: Target Tension | Actual Tension | Beat Type Match (YES/NO) | Notes\n\n` +
        `## F. Relationship Dynamics (ONLY pairs who interacted in Chapter ${ch})\n` +
        `Update ONLY relationship pairs where both characters appeared or interacted in this chapter.\n` +
        `Output: Pair | Dynamic | Intensity Change | Key Moment\n\n` +
        `## G. NARRATIVE DIRECTIVES (SCOPED to next chapter ONLY)\n` +
        `Consult the Chapter Outline to determine WHO is the POV character and which supporting cast appear in Chapter ${ch + 1}.\n` +
        `Generate directives ONLY for those characters — do NOT include characters who won't appear.\n\n` +
        `For the NEXT CHAPTER'S POV character:\n` +
        `- State their current stat levels and threshold band (Peak/Stable/Stressed/Critical)\n` +
        `- Describe how their internal monologue should sound at these levels\n` +
        `- Note relationship tensions with other characters IN THAT CHAPTER\n` +
        `- Flag if any stat is near a threshold boundary\n\n` +
        `For each SUPPORTING character appearing in Chapter ${ch + 1}:\n` +
        `- One-line stat summary and current emotional posture\n` +
        `- How they should behave toward the POV character based on relationship dynamics\n\n` +
        `IMPORTANT: If a character last appeared 3+ chapters ago, add a brief "Last seen" note so the writer knows where they left off.\n` +
        `Example: "Marcus (POV) — Sanity: 35/Stressed. Write with paranoid undertone. Shorter sentences. Misreads Sarah's concern as suspicion."\n` +
        `Example: "Sarah (supporting, last seen Ch ${ch - 2}) — Trust toward Marcus dropped to 4/10 after the lab incident. She will be guarded and evasive."`,
        { chapterNumber: ch }));

      // Continuity Check every 5 chapters
      if (ch % 5 === 0 && ch < chapters) {
        steps.push(step(idx++, `Continuity Check (Ch 1-${ch})`, 'analysis', 'continuity_check',
          `Review the narrative of "${title}" from the Prologue through Chapter ${ch} for internal contradictions.\n\n` +
          `Check for:\n` +
          `- Characters in two places at once\n` +
          `- Timeline impossibilities\n` +
          `- Attribute contradictions (appearance, age, weapon, etc.)\n` +
          `- Dropped plot threads that were set up but never advanced\n` +
          `- Name/spelling inconsistencies\n` +
          `- Faction allegiance contradictions\n` +
          `- References to characters, locations, or concepts that do NOT exist in the project Bible/Outline\n` +
          `- Information revealed too early (the reader should not know information that hasn't been established or suggested yet)\n` +
          `- CRITICAL: ONLY evaluate the text from Prologue through Chapter ${ch}. Do NOT hallucinate contradictions involving future chapters that have not been written yet.\n\n` +
          `OUTPUT FORMAT (you MUST follow this exactly):\n` +
          `If NO issues found, respond with EXACTLY: "No continuity issues detected through Chapter ${ch}." and NOTHING ELSE.\n\n` +
          `If issues ARE found, use this format for EACH issue, and DO NOT include the "No continuity issues" phrase anywhere in your response:\n` +
          `### [Issue Number]. [Short Title]\n` +
          `**Contradiction:** [Describe the contradiction]\n` +
          `**Affected Chapters:** Chapter [N], Chapter [M] (list ALL affected chapter numbers explicitly)\n` +
          `**Suggested Fix:** [Describe the fix]\n`,
          { chapterNumber: ch }));
      }
    }

    if (ctx.includeEpilogue) {
      const actualWords = wordsPerChapter;
      const segments = Math.max(1, Math.ceil(actualWords / 3000));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `Epilogue — Part ${s}` : 'Epilogue';
        const isFirstSeg = s === 1;
        const isLastSeg = s === segments;
        const continuationBlock = !isFirstSeg
          ? `CONTINUATION RULES (MANDATORY):\n` +
            `- You MUST continue the narrative EXACTLY where Part ${s - 1} left off.\n` +
            `- The Preceding Text context shows you the last 250 words of Part ${s - 1}. Pick up mid-scene, mid-paragraph if necessary.\n` +
            `- Do NOT restart the epilogue. Do NOT re-introduce characters or settings already established.\n` +
            `- Do NOT repeat any prose from previous parts.\n\n`
          : '';
        steps.push(step(idx++, segName, 'writing', 'creative_writing',
          (isFirstSeg
            ? `Write the beginning of the Epilogue for "${title}" based on the outline and previous chapters.\n\n`
            : `CONTINUE writing the Epilogue for "${title}". This is Part ${s} of ${segments}.\n\n` + continuationBlock) +
          `Requirements:\n` +
          `- Target word count: ${wordsPerSegment} words. HARD LIMIT: Do NOT exceed ${wordsPerSegment + 200} words.\n` +
          (segments > 1 ? `- You are writing Part ${s} of ${segments}. Write fully immersive prose for THIS segment only.\n` : '') +
          (isFirstSeg ? `- Begin resolving lingering tension.\n` : '') +
          (isLastSeg ? `- Establish the new status quo (or set up a sequel).\n` : '') +
          `- Write complete prose, not summary\n` +
          `- Stay consistent with the character bible and world building\n` +
          `- SCENE DIVERSITY: Vary the narrative mode. Include at least TWO of: dialogue exchange, action/movement, environmental description, internal monologue.\n` +
          `- PUNCTUATION: Em dashes (—) are PROHIBITED except for sharp interruptions. Maximum 1 per 500 words. Use commas, semicolons, colons, or period breaks instead. Two em dashes in the same sentence is a HARD FAILURE.\n` +
          (!isLastSeg ? `- End mid-flow so the next part can continue seamlessly.\n\n` : '\n\n'),
          { wordCountTarget: wordsPerSegment, chapterNumber: chapters + 1, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, 'Epilogue — Compile Draft', 'writing', 'draft_compile',
          `Mechanical compilation of all drafted segments for the Epilogue.`,
          { chapterNumber: chapters + 1, totalSegments: segments }));
      }

      steps.push(step(idx++, `Epilogue — POV Check`, 'analysis', 'pov_check',
        `Perform a comprehensive narrative quality analysis of the Epilogue of "${title}".\n\n` +
        `## 1. POV Analysis\n` +
        `- Which character's POV was actually used in this chapter?\n` +
        `- Does it match the POV character specified in the Chapter Outline?\n` +
        `- Is the Deep POV consistent — does every description, internal thought, and observation reflect ONLY what this character would notice/know?\n\n` +
        `## 2. Pacing & Plot Advancement\n` +
        `- Does the chapter spend its word count wisely, or is it padded with filler?\n` +
        `- Does the plot ACTUALLY advance, or is it all internal monologue and world-building?\n` +
        `- Are events happening, or is the character just thinking/walking/observing?\n\n` +
        `## 3. Plot Thread Tracking\n` +
        `- Which plot threads from the Chapter Outline were advanced in this chapter?\n` +
        `- Which B-story or C-story threads were woven in?\n` +
        `- Were any threads that SHOULD have been addressed (per the outline) completely ignored?\n\n` +
        `## 4. Chapter Hook\n` +
        `- Does the chapter end on a genuine cliffhanger, revelation, or tension point?\n` +
        `- Would a reader feel compelled to turn the page, or does it fizzle?\n\n` +
        `## 5. Prose Quality\n` +
        `- Identify any "Show vs Tell" violations where the text TELLS the reader about emotions instead of SHOWING them through action, dialogue, or sensation.\n` +
        `- List any filter words found (felt, saw, noticed, realized, seemed, wondered, watched, heard, knew, thought, decided). Quote the exact sentence for each.\n\n` +
        `## 6. Trope Execution\n` +
        `- Which genre tropes identified in the Market & Genre Analysis are being actively deployed or subverted in this chapter?\n` +
        `- Are any tropes being executed too literally (cliché) rather than with a fresh twist?\n` +
        `- Are expected reader payoffs from established tropes being set up or delivered?\n\n` +
        `## 7. AI-Ism Check\n` +
        `- Identify any "Rule of Three" (Tricolon) patterns (e.g., "He was X. He was Y. He was Z.").\n` +
        `- Identify repetitive or explicit dialogue attribution (flag if every line has "said/replied" instead of action beats).\n` +
        `- Identify formulaic fragments for effect ("He gasped. A wet sound.").\n` +
        `- Identify cliché similes ("heart hammering like a trapped bird").\n` +
        `- Identify Nominalization (excessive use of -tion, -ment, -ness words instead of active verbs).\n` +
        `- Identify Present Participle overuse (starting multiple sentences with -ing clauses).\n` +
        `- Identify Adjective Stacking (e.g., "the dark, oppressive, shimmering room").\n\n` +
        `OUTPUT FORMAT (you MUST follow this exactly):\n` +
        `- **POV Character**: [name]\n` +
        `- **Outline Match**: YES/NO\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10] (10 = every scene earns its word count, 1 = nothing happens)\n` +
        `- **Hook Score**: [1-10] (10 = unputdownable cliffhanger, 1 = flat ending)\n` +
        `- **Plot Threads Advanced**: [list which outline threads moved forward]\n` +
        `- **Plot Threads Stalled**: [list threads that should have advanced but didn't, or "None"]\n` +
        `- **Tropes Deployed**: [list tropes actively used or subverted in this chapter, or "None"]\n` +
        `- **Trope Warnings**: [flag any tropes executed as cliché without a fresh angle, or "None"]\n` +
        `- **Filter Words Found**: [list exact sentences containing filter words, or "None"]\n` +
        `- **Show vs Tell Violations**: [list passages that tell emotions, or "None"]\n` +
        `- **AI-Isms Found**: [list any Rule of Three, repetitive dialogue tags, formulaic fragments, or cliché similes, or "None"]\n` +
        `Output: Character | Faction | Start Rep | Final Rep | Label | Arc Summary\n` +
      `${ctx.includePrologue ? ', Prologue' : ''}${ctx.includeEpilogue ? ', Epilogue' : ''}.`));
    }
    return steps;
  }
};

export function generateCalibrationPassSteps(
  pass: number,
  idx: number,
  title: string,
  sharedContext: string,
  isFinalPass: boolean,
  currentDna?: { positive: string[], negative: string[] },
  totalChapters: number = 25
): ProjectStep[] {
  const steps: ProjectStep[] = [];
  const povCheckFormat = `## 1. POV Analysis\n` +
    `- Which character's POV was actually used in this chapter?\n` +
    `- Does it match the POV character specified in the Chapter Outline?\n` +
    `- Is the Deep POV consistent — does every description, internal thought, and observation reflect ONLY what this character would notice/know?\n\n` +
    `## 2. Pacing & Plot Advancement\n` +
    `- Does the chapter spend its word count wisely, or is it padded with filler?\n` +
    `- Does the plot ACTUALLY advance, or is it all internal monologue and world-building?\n` +
    `- Are events happening, or is the character just thinking/walking/observing?\n\n` +
    `## 3. Plot Thread Tracking\n` +
    `- Which plot threads from the Chapter Outline were advanced in this chapter?\n` +
    `- Which B-story or C-story threads were woven in?\n` +
    `- Were any threads that SHOULD have been addressed (in this chapter) completely ignored?\n\n` +
    `## 4. Chapter Hook\n` +
    `- Does the chapter end on a genuine cliffhanger, revelation, or tension point?\n` +
    `- Would a reader feel compelled to turn the page, or does it fizzle?\n\n` +
    `## 5. Prose Quality\n` +
    `- Identify any "Show vs Tell" violations where the text TELLS the reader about emotions instead of SHOWING them through action, dialogue, or sensation.\n` +
    `- List any filter words found (felt, saw, noticed, realized, seemed, wondered, watched, heard, knew, thought, decided). Quote the exact sentence for each.\n\n` +
    `## 6. Trope Execution\n` +
    `- Which genre tropes identified in the Market & Genre Analysis are being actively deployed or subverted in this chapter?\n` +
    `- Are any tropes being executed too literally (cliché) rather than with a fresh twist?\n` +
    `- Are expected reader payoffs from established tropes being set up or delivered?\n\n` +
    `## 7. AI-Ism Check\n` +
    `- Identify any "Rule of Three" (Tricolon) patterns (e.g., "He was X. He was Y. He was Z.").\n` +
    `- Identify repetitive or explicit dialogue attribution (flag if every line has "said/replied" instead of action beats).\n` +
    `- Identify formulaic fragments for effect ("He gasped. A wet sound.").\n` +
    `- Identify cliché similes ("heart hammering like a trapped bird").\n` +
    `- Identify Nominalization (excessive use of -tion, -ment, -ness words instead of active verbs).\n` +
    `- Identify Present Participle overuse (starting multiple sentences with -ing clauses).\n` +
    `- Identify Adjective Stacking (e.g., "the dark, oppressive, shimmering room").\n` +
    `- Identify Structural AI-Isms like numbered lists, bullet points, <AWAITING PROSE> tags, or meta-commentary in the prose (These MUST trigger a REWRITE).\n\n` +
    `OUTPUT FORMAT (you MUST follow this exactly):\n` +
    `- **POV Character**: [name]\n` +
    `- **Outline Match**: YES/NO\n` +
    `- **Deep POV Score**: [1-10]\n` +
    `- **Pacing Score**: [1-10] (10 = every scene earns its word count, 1 = nothing happens)\n` +
    `- **Hook Score**: [1-10] (10 = unputdownable cliffhanger, 1 = flat ending)\n` +
    `- **Plot Threads Advanced**: [list which outline threads moved forward]\n` +
    `- **Plot Threads Stalled**: [list threads that should have advanced but didn't, or "None"]\n` +
    `- **Tropes Deployed**: [list tropes actively used or subverted in this chapter, or "None"]\n` +
    `- **Trope Warnings**: [flag any tropes executed as cliché without a fresh angle, or "None"]\n` +
    `- **Filter Words Found**: [list exact sentences containing filter words, or "None"]\n` +
    `- **Show vs Tell Violations**: [list passages that tell emotions, or "None"]\n` +
    `- **AI-Isms Found**: [list any Rule of Three, repetitive dialogue tags, formulaic fragments, or cliché similes, or "None"]\n` +
    `- **Repetition Audit**: [list any phrase, image, or motif that appears 3+ times in the chapter. Quote the repeated phrase and count. Flag as CRITICAL if 5+. Or "None"]\n` +
    `- **Em Dash Count**: [total count of em dashes (—) in the chapter. Flag as EXCESSIVE if more than 6 per 1000 words]\n` +
    `- **Issues**: [list any POV breaks, head-hopping, or other problems]\n- **Verdict**: PASS / REVISE / REWRITE`;

  // Build prior-pass directive reference for passes 2+
  const priorPassRef = (pass > 1
    ? `\n\n## DIRECTIVES FROM PASS ${pass - 1}\nThe Pass ${pass - 1} Summary step identified specific issues. ` +
      `Your primary goal this pass is to FIX THOSE ISSUES. ` +
      `The summary's improvement directives are available in your context — treat them as mandatory constraints.\n`
    : '') + `\n\n## STRICT PROSE RULES\n- NEVER use ellipses (..., ..) or trailing thoughts. End sentences with hard periods.\n- NEVER use double-dashes (--) or triple-dashes (---). Use proper em-dashes (—) sparingly — maximum 2 per 400 words. These artifacts are lazy and strictly forbidden.\n- NEVER vary sentence rhythm monotonously. Deliberately mix very short sentences (3–6 words) with longer ones (20+ words).\n- OUTPUT ONLY PROSE. Do NOT append any annotations, metadata, notes, or bracket comments like [Narrator voice:], [Technique:], [POV Anchor], [Word count], or any [square bracket] commentary. The output must be raw manuscript prose and nothing else.\n`;
    // Original definition bypassed

  // ── Chapter-Anchored Scene Rotation ──────────────────────────────────────────────────────
  // Each pass maps to a specific chapter in the project outline, cycling back to chapter 1
  // when passes exceed the chapter count. This ensures training data is evenly distributed
  // across all chapters of the real book rather than repeating generic scenarios.
  const chapterNum = ((pass - 1) % totalChapters) + 1;
  const chapterAnchor = `CHAPTER ${chapterNum} OF THE PROJECT OUTLINE`;

  const actionSeed =
    `Anchor this scene to ${chapterAnchor}. ` +
    `Consult the Chapter Outline in your context for Chapter ${chapterNum}: ` +
    `use that chapter's POV character, physical location, and primary conflict. ` +
    `Write the ACTION version of the key physical confrontation or crisis in that chapter. ` +
    `Do NOT invent a new setting — use what the outline specifies.`;

  const dialogueSeed =
    `Anchor this scene to ${chapterAnchor}. ` +
    `Consult the Chapter Outline in your context for Chapter ${chapterNum}: ` +
    `use that chapter's POV character and the key relationship tension or confrontation described. ` +
    `Write a DIALOGUE scene between the POV character and one of the supporting characters present in that chapter. ` +
    `Do NOT invent characters — use the cast specified in the outline.`;

  const introspectionSeed =
    `Anchor this scene to ${chapterAnchor}. ` +
    `Consult the Chapter Outline in your context for Chapter ${chapterNum}: ` +
    `use that chapter's POV character and the key decision, revelation, or emotional beat described. ` +
    `Write the INTROSPECTIVE aftermath — the character processing that event in private, grounded in physical sensation. ` +
    `Use the emotional arc specified for that chapter as the internal journey.`;

  const settingSeed =
    `Anchor this scene to ${chapterAnchor}. ` +
    `Consult the Chapter Outline in your context for Chapter ${chapterNum}: ` +
    `use that chapter's POV character and the primary new location or environment they enter. ` +
    `Write the SETTING/EXPOSITION introduction — the character experiencing this space for the first time. ` +
    `Establish atmosphere purely through the character's physical interaction with the environment.`;

  // ── Test 1: Action & Pacing (POV Anchor System) ──────────────────────────────────────────
  steps.push(step(idx++, `Pass ${pass}: Action Sample — Part 1`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: ACTION & PACING\n` +
    `Write the FIRST 400 words of an ACTION scene.\n\n` +
    `## SCENARIO FOR THIS PASS\n${actionSeed}\n` +
    `YOU MUST USE THIS SPECIFIC SETTING. Do NOT default to a generic corridor fight.\n\n` +
    `## SENSORY PALETTE LOCK\n` +
    `Before writing, choose ONE smell, ONE texture, and ONE sound that will recur as anchors throughout the scene.\n` +
    `Do NOT write these choices down — let them drive every paragraph invisibly.\n\n` +
    `## POV ANCHOR — Complete This Before Writing\n` +
    `Resolve these three points in your own logic before generating a single word:\n` +
    `1. Who is the POV character? (name only)\n` +
    `2. What is the exact surface they are physically touching right now?\n` +
    `3. What is the ONE thing they want to achieve in the next 30 seconds?\n` +
    `Do NOT write these answers out — use them to lock your POV. Then write.\n\n` +
    `Requirements:\n` +
    `- Open IN MEDIAS RES — the action must already be happening on word 1\n` +
    `- Use SHORT sentences (5-12 words) for peak action beats\n` +
    `- Every action must have a physical CONSEQUENCE (cause → effect chain)\n` +
    `- At least TWO non-visual sensory details (smell, pain, sound, texture)\n` +
    `- Zero filter words: no felt, noticed, saw, heard, realized, looked, stared\n` +
    `- Zero named emotions: show the state through somatic markers only\n` +
    `- End mid-scene — do NOT resolve the action. A continuation will follow.\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 1, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Action Sample — Part 2`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: ACTION & PACING (Continuation)\n` +
    `You are continuing the Action scene started in Part 1. The preceding 400 words are in your context.\n` +
    `THE SCENARIO: ${actionSeed}\n\n` +
    `## MANDATORY SELF-AUDIT — Do This Before Writing a Single Word\n` +
    `Scan the preceding 400 words for these specific failures:\n` +
    `- Any sentence starting with "He/She looked", "He/She noticed", "He/She felt", "He/She thought", "He/She stared", "He/She remembered"\n` +
    `- Any sentence that NAMES an emotion directly (e.g., "desperation", "panic", "relief", "fear")\n` +
    `- Any sentence that attributes an internal state or gaze to a NON-POV character\n` +
    `If you find violations: correct them in your head, then continue. Do NOT list corrections — just write clean prose.\n\n` +
    `Requirements:\n` +
    `- Continue seamlessly from Part 1\n` +
    `- End on a beat that forces the character to make a concrete decision\n` +
    `- ZERO filter words — every beat must be externally observable or somatic\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 1, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Action Sample — Compile`, 'writing', 'draft_compile',
    `Mechanical compilation: combine Pass ${pass} Action Sample Part 1 and Part 2 into a single seamless document. Output only the merged prose — no headers, no commentary.`,
    { chapterNumber: 100 * pass + 1, totalSegments: 2 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Action Sample — POV Check`, 'analysis', 'pov_check',
    `Perform a rigorous narrative quality analysis of the compiled Action Sample from Pass ${pass}.\n` +
    `Be merciless on: filter words, pacing flatness, sensory absence, consequence-free action, and AI-isms.\n\n` +
    povCheckFormat,
    { chapterNumber: 100 * pass + 1 }
  ));

  // ── Test 2: Dialogue & Subtext (POV Anchor System) ───────────────────────────────────────
  steps.push(step(idx++, `Pass ${pass}: Dialogue Sample — Part 1`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: DIALOGUE & SUBTEXT\n` +
    `Write the FIRST 400 words of a DIALOGUE scene between two characters who want DIFFERENT THINGS.\n\n` +
    `## SCENARIO FOR THIS PASS\n${dialogueSeed}\n` +
    `YOU MUST USE THIS SPECIFIC SETTING. Do NOT default to a generic confrontation.\n\n` +
    `## SENSORY PALETTE LOCK\n` +
    `Choose ONE environmental detail (a sound, a smell, an object) that will ground the scene physically.\n` +
    `Return to it at least once. Do NOT write this choice down — weave it in invisibly.\n\n` +
    `## POV ANCHOR — Complete This Before Writing\n` +
    `Resolve these three points before generating a single word:\n` +
    `1. Who is the POV character? What do they want from this conversation?\n` +
    `2. What is one physical object in the room the POV character is aware of right now?\n` +
    `3. What is the ONE thing the other character wants that directly conflicts?\n` +
    `Do NOT write these answers out — use them to lock your scene. Then write.\n\n` +
    `Requirements:\n` +
    `- Characters must NOT say what they actually mean — use subtext and deflection\n` +
    `- Use "said" or action beats ONLY — zero exotic dialogue tags (hissed, growled, snapped)\n` +
    `- Differentiate voices: you must be able to identify the speaker without the tag\n` +
    `- End mid-exchange — do NOT resolve the conflict. A continuation will follow.\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 2, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Dialogue Sample — Part 2`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: DIALOGUE & SUBTEXT (Continuation)\n` +
    `You are continuing the Dialogue scene started in Part 1. The preceding 400 words are in your context.\n` +
    `THE SCENARIO: ${dialogueSeed}\n\n` +
    `## MANDATORY SELF-AUDIT — Do This Before Writing a Single Word\n` +
    `Scan the preceding 400 words for these specific failures:\n` +
    `- Any sentence attributing a specific emotion or internal reaction to the NON-POV character\n` +
    `- Any dialogue that says the subtext explicitly instead of implying it\n` +
    `- Any "he/she felt/noticed/thought" filter sentence\n` +
    `If you find violations: correct them in your head, then continue. Do NOT list corrections — just write clean prose.\n\n` +
    `Requirements:\n` +
    `- Continue seamlessly from Part 1\n` +
    `- Embed at least ONE piece of world/faction information through natural conversation — no info-dumps\n` +
    `- End on an unresolved tension — the thing they were really fighting about is never named\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 2, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Dialogue Sample — Compile`, 'writing', 'draft_compile',
    `Mechanical compilation: combine Pass ${pass} Dialogue Sample Part 1 and Part 2 into a single seamless document. Output only the merged prose — no headers, no commentary.`,
    { chapterNumber: 100 * pass + 2, totalSegments: 2 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Dialogue Sample — POV Check`, 'analysis', 'pov_check',
    `Perform a rigorous narrative quality analysis of the compiled Dialogue Sample from Pass ${pass}.\n` +
    `Be merciless on: on-the-nose dialogue, identical character voices, repetitive tags, info-dumping, and unearned subtext.\n\n` +
    povCheckFormat,
    { chapterNumber: 100 * pass + 2 }
  ));

  // ── Test 3: Introspection & Deep POV (POV Anchor System) ────────────────────────────────
  steps.push(step(idx++, `Pass ${pass}: Introspection Sample — Part 1`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: INTROSPECTION & DEEP POV\n` +
    `Write the FIRST 400 words of an INTROSPECTION scene showing a character processing a recent event or decision.\n\n` +
    `## SCENARIO FOR THIS PASS\n${introspectionSeed}\n` +
    `YOU MUST USE THIS SPECIFIC SETTING. Do NOT default to a generic corridor or engine room.\n\n` +
    `## POV ANCHOR — Complete This Before Writing\n` +
    `Resolve these three points before generating a single word:\n` +
    `1. Who is the POV character? What specific event are they replaying in their mind?\n` +
    `2. What ONE physical sensation are they experiencing RIGHT NOW? (not an emotion — a body sensation)\n` +
    `3. What conclusion do they NOT want to reach? (the thing they are avoiding acknowledging)\n` +
    `Do NOT write these answers out — use them to drive every sentence. Then write.\n\n` +
    `Requirements:\n` +
    `- ZERO thought verbs: no "realized", "wondered", "thought", "felt", "noticed"\n` +
    `- The character's biases must bleed into every description — the world looks DIFFERENT through their eyes\n` +
    `- Use physical sensation as the anchor for emotion (clenched jaw, not "felt angry")\n` +
    `- End mid-introspection — do NOT resolve. A continuation will follow.\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 3, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Introspection Sample — Part 2`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: INTROSPECTION & DEEP POV (Continuation)\n` +
    `You are continuing the Introspection scene started in Part 1. The preceding 400 words are in your context.\n` +
    `THE SCENARIO: ${introspectionSeed}\n\n` +
    `## MANDATORY SELF-AUDIT — Do This Before Writing a Single Word\n` +
    `Scan the preceding 400 words for these specific failures:\n` +
    `- Any sentence containing: felt, thought, realized, wondered, noticed, remembered, imagined\n` +
    `- Any sentence that NAMES an emotion as a noun or adjective (e.g., "a wave of grief", "sudden panic")\n` +
    `- Any sentence that summarizes the MEANING of what the character is processing ("He had failed." / "It was over.")\n` +
    `If you find violations: correct them in your head, then continue. Do NOT list corrections — just write clean prose.\n\n` +
    `Requirements:\n` +
    `- Continue seamlessly from Part 1\n` +
    `- Include at least one memory or past-event intrusion that recontextualises the present\n` +
    `- Sentence rhythm must slow and lengthen compared to the Action sample\n` +
    `- End on a concrete physical action or sensory detail. Do NOT summarize the theme.\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 3, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Introspection Sample — Compile`, 'writing', 'draft_compile',
    `Mechanical compilation: combine Pass ${pass} Introspection Sample Part 1 and Part 2 into a single seamless document. Output only the merged prose — no headers, no commentary.`,
    { chapterNumber: 100 * pass + 3, totalSegments: 2 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Introspection Sample — POV Check`, 'analysis', 'pov_check',
    `Perform a rigorous narrative quality analysis of the compiled Introspection Sample from Pass ${pass}.\n` +
    `Be merciless on: thought verbs, told emotions, floating-head syndrome (no physical grounding), and filter words.\n\n` +
    povCheckFormat,
    { chapterNumber: 100 * pass + 3 }
  ));

  // ── Test 4: Setting & World-Building (Anti-Info-Dump) ──────────────────────────────
  steps.push(step(idx++, `Pass ${pass}: Setting Sample — Part 1`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: SETTING & WORLD-BUILDING\n` +
    `Write the FIRST 400 words of a SETTING/EXPOSITION scene where a character enters a new location.\n\n` +
    `## SCENARIO FOR THIS PASS\n${settingSeed}\n` +
    `YOU MUST USE THIS SPECIFIC SETTING. Do NOT default to generic environments.\n\n` +
    `## POV ANCHOR — Complete This Before Writing\n` +
    `Resolve these three points before generating a single word:\n` +
    `1. Who is the POV character? What are they looking for in this room/location?\n` +
    `2. What is one object they must physically manipulate or move past to enter?\n` +
    `3. What sensory detail here fundamentally contrasts with where they just came from?\n` +
    `Do NOT write these answers out — use them to drive the interaction. Then write.\n\n` +
    `Requirements:\n` +
    `- NO "tour guide" descriptions: do not pause the narrative to explain what the room looks like.\n` +
    `- Reveal the scale and atmosphere purely through the character's movement and tactile interaction.\n` +
    `- NO historical info-dumps about the location's past unless the character actively uncovers it.\n` +
    `- End mid-scene before they find what they are looking for.\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 4, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Setting Sample — Part 2`, 'writing', 'creative_writing',
    `${sharedContext}${priorPassRef}\n\n## SCENE TYPE: SETTING & WORLD-BUILDING (Continuation)\n` +
    `You are continuing the Setting scene started in Part 1. The preceding 400 words are in your context.\n` +
    `THE SCENARIO: ${settingSeed}\n\n` +
    `## MANDATORY SELF-AUDIT — Do This Before Writing a Single Word\n` +
    `Scan the preceding 400 words for these specific failures:\n` +
    `- Any sentence that begins with "It was..." followed by an adjective (e.g., "It was a dark room").\n` +
    `- Any paragraph that describes architecture without the character moving through it.\n` +
    `- Any use of clichés like "sprawling labyrinth", "testament to", "stark contrast".\n` +
    `If you find violations: correct them in your head, then continue. Do NOT list corrections — just write clean prose.\n\n` +
    `Requirements:\n` +
    `- Continue seamlessly from Part 1\n` +
    `- Introduce a piece of technology or a faction artifact without explaining how it works — just how it affects the character.\n` +
    `- End with the character finally discovering the focal point of the room.\n` +
    `- Word count target: exactly 400 words`,
    { chapterNumber: 100 * pass + 4, wordCountTarget: 400 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Setting Sample — Compile`, 'writing', 'draft_compile',
    `Mechanical compilation: combine Pass ${pass} Setting Sample Part 1 and Part 2 into a single seamless document. Output only the merged prose — no headers, no commentary.`,
    { chapterNumber: 100 * pass + 4, totalSegments: 2 }
  ));
  steps.push(step(idx++, `Pass ${pass}: Setting Sample — POV Check`, 'analysis', 'pov_check',
    `Perform a rigorous narrative quality analysis of the compiled Setting Sample from Pass ${pass}.\n` +
    `Be merciless on: info-dumping, tour-guide descriptions, "It was" constructions, and lack of physical grounding.\n\n` +
    povCheckFormat,
    { chapterNumber: 100 * pass + 4 }
  ));

  // ── Pass Summary & Directive Generator ──────────────────────────────
  steps.push(step(idx++, `Pass ${pass}: Summary & Improvement Directives`, 'analysis', 'analysis',
    `You have just reviewed FOUR POV Quality Gate reports from Pass ${pass} of the Style Calibration run for "${title}".\n\n` +
    `The four reports cover an Action scene (chapter ref ${100 * pass + 1}), a Dialogue scene (chapter ref ${100 * pass + 2}), ` +
    `and an Introspection scene (chapter ref ${100 * pass + 3}).\n\n` +
    `## Your Task\n\n` +
    `1. **Aggregate Scores** — Create a summary table:\n` +
    `   | Scene | Deep POV | Pacing | Hook | Dialogue | Verdict |\n` +
    `   |-------|----------|--------|------|----------|---------|\n\n` +
    `2. **Cross-Scene Pattern Analysis** — Identify issues that appeared in 2 or more scenes ` +
    `(e.g., "filter word 'felt' appeared in all four scenes", "dialogue tags violated in Action and Dialogue samples"). ` +
    `These are SYSTEMIC issues — the model's default habits.\n\n` +
    `3. **Ranked Issue List** — List all issues across all four scenes, ranked by severity (most damaging first).\n\n` +
    `4. **Pass ${pass + 1} Improvement Directives** — Write ${!isFinalPass ? `exactly 5` : `a final set of`} ` +
    `specific, actionable directives for the ${!isFinalPass ? `next pass` : `writing team`}. ` +
    `Format each as a direct instruction:\n` +
    `   - "DO: [positive behaviour to adopt or keep doing if they scored well (9/10)]"\n` +
    `   - "AVOID: [specific pattern identified in the POV checks]"\n\n` +
    `5. **Overall Assessment** — Rate the model's current prose quality on a scale of 1–10 for this pass, ` +
    `with a one-paragraph verdict on readiness for full-length manuscript generation.\n\n` +
    `6. **DNA Compression & JSON Export** — MANDATORY. This JSON block feeds the automated LoRA training pipeline. ` +
    `You MUST output a raw JSON object at the VERY BOTTOM of your response, even if no new violations were found. ` +
    `Review the existing Global Style Directives (if provided) and merge them with your new findings from Pass ${pass}. ` +
    `Eliminate redundant rules, discard rules the model has completely mastered, keep rules still needed. ` +
    `Output EXACTLY 5 "positive" (DO) and 5 "negative" (AVOID) rules — no more, no fewer. ` +
    `Each rule must be a single, concrete, actionable instruction referencing a specific technique or violation pattern. ` +
    `Output ONLY the JSON enclosed in \`\`\`json blocks — no prose after it:\n` +
    `\`\`\`json\n{\n  "positive": [\n    "DO: Use concrete physical reactions for internal conflict"\n  ],\n  "negative": [\n    "AVOID: The 'X but Y' binary contrast structure"\n  ]\n}\n\`\`\`\n\n` +
    (currentDna ? `## EXISTING GLOBAL STYLE DNA (To be compressed & merged)\n**Positive Directives:**\n${currentDna.positive.map(d => `- ${d}`).join('\n')}\n**Negative Directives:**\n${currentDna.negative.map(d => `- ${d}`).join('\n')}\n\n` : '') +
    (!isFinalPass
      ? `These directives will be automatically injected into Pass ${pass + 1} writing prompts.`
      : `This is the final pass. Provide a definitive readiness verdict.`),
    { chapterNumber: 100 * pass + 99 }
  ));

  return steps;
}

const styleCalibration: ProjectTemplate = {
  type: 'style-calibration',
  name: 'Style Calibration (Adversarial Setup)',
  description: 'Adversarial training grounds. Generates three short sample scenes (Action, Dialogue, Introspection) and subjects them to rigorous POV Quality Gates, then synthesizes improvement directives for the next pass. The "Target Chapters" setting determines how many passes (iterations) it runs.',
  buildSteps: (ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;
    const passes = ctx.targetChapters || 1;

    // Shared context block — injected into every writing prompt so the model
    // knows exactly which characters, voice targets, and anti-patterns to use.
    const sharedContext = [
      `## NOVEL CONTEXT`,
      `Title: "${title}"`,
      ...(description ? [``, `## PROJECT DESCRIPTION`, description] : []),
      ``,
      `## WORLD & CHARACTER CONTEXT (from Book Bible)`,
      `MANDATORY: You MUST consult the 'Character Bible', 'Faction Bible', and 'World Building' documents in your context.`,
      `Use the exact character traits, faction allegiances, and sensory rules defined there.`,
      ``,
      `## YOUR TASK`,
      `This is a STYLE CALIBRATION TEST — not a chapter of the final manuscript.`,
      `Your output will be evaluated by a strict POV Quality Gate immediately after generation.`,
      `Choose your own POV character from the cast — pick whoever fits the scene type best.`,
      ``,
      ``,
      `## ANTI-PATTERNS — DO NOT USE THESE`,
      `1. "In the blink of an eye" for action transitions`,
      `2. "The weight of the world" clichés in introspective moments`,
      `3. Overusing "Quantum" as a noun (e.g., "a quantum of dread")`,
      `4. "Ghostly" or "Soulless" to describe digital entities`,
      `5. "Heartbeats of the Drift" as a metaphor`,
      `6. "The storm of emotions" in character reactions`,
      `7. Filter words: felt, noticed, saw, heard, realized, wondered, thought`,
      `8. Repetitive dialogue tags (hissed, growled, snapped, exclaimed, etc.)`,
      `9. "The Drift whispered" as passive agency`,
      `10. "Data streams flowed like rivers" for technical descriptions`,
      `11. AI-isms and cliché words: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth"`,
      `12. Overdramatic physical reactions: "a shiver ran down his spine", "his blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding"`,
      `13. Grandiose metaphorical filler: "a delicate dance", "beacon of hope", "silent guardian", "symphony of destruction"`,
      ``,
      `## STRICT NEGATIVE CONSTRAINTS (MANDATORY)`,
      `1. NEVER use "Negative Telling" — never describe what a character *didn't* do or feel (e.g., "he didn't flinch"). Only describe concrete actions they *did* take.`,
      `2. NO "Analytical Summaries" — DO NOT explain the "meaning" or "purpose" of any action or setting. Only state the raw sensory facts and let the reader infer the stakes.`,
      `3. AVOID "Syntactic Monotony" — DO NOT start consecutive sentences with the same pronoun or noun (e.g., "He", "The"). Vary sentence openings using prepositional phrases, gerunds, or action beats.`
    ].join('\n');

    if (ctx.isInfiniteCalibration) {
      // For infinite loops, only generate Pass 1 upfront.
      // totalChapters defaults to targetChapters (used for the chapter-anchor rotation).
      const totalChapters = ctx.targetChapters || 25;
      const passSteps = generateCalibrationPassSteps(1, idx, title, sharedContext, false, undefined, totalChapters);
      steps.push(...passSteps);
    } else {
      const totalChapters = passes; // finite mode: rotate across the configured pass count
      for (let pass = 1; pass <= passes; pass++) {
        const passSteps = generateCalibrationPassSteps(pass, idx, title, sharedContext, pass === passes, undefined, totalChapters);
        steps.push(...passSteps);
        idx += passSteps.length;
      }
    }

    return steps;
  }
};


const deepRevision: ProjectTemplate = {
  type: 'deep-revision',
  name: 'Deep Revision',
  description: '8-pass specialist editorial pipeline: structure → arcs → theme → per-chapter craft audits → rewrite gate',
  buildSteps: (ctx, title, description) => {
    const chapters = ctx.targetChapters || 25;
    const steps: ProjectStep[] = [];
    let idx = 1;

    // ── Manuscript-Level Passes (run once across the whole book) ──────────

    steps.push(step(idx++, 'Structural Arc Audit', 'analysis', 'analysis',
      `Perform a structural arc audit of the entire manuscript for "${title}".

## Task
Map the manuscript against the 3-Act structure and Save the Cat beat sheet:
- Act 1 (Setup): chapters covering theme stated, catalyst, debate, break into Act 2
- Act 2A (Fun & Games): chapters covering B-story, midpoint promise of the premise
- Act 2B (Bad Guys Close In): chapters covering dark night of the soul, all-is-lost moment
- Act 3 (Finale): chapters covering finale, final image

For each chapter (1-${chapters}), assign:
- Which structural beat it occupies (or "connective tissue" if none)
- Tension level on a 1-10 scale
- Whether the chapter ends on a rising or falling tension beat

Then flag:
- Any act that is structurally bloated (>40% of the book)
- Any act that is compressed (too fast, no breathing room)
- Missing beats (e.g. no clear midpoint, no all-is-lost moment)
- Tension valleys where 3+ consecutive chapters are below 5/10 tension

Output a tension curve table and a structural health verdict.`));

    steps.push(step(idx++, 'Character Arc Tracker', 'analysis', 'analysis',
      `Track every major POV character's arc across the entire manuscript of "${title}".

For each POV character:
1. State their emotional/moral position at the START of Chapter 1
2. State their position at the END of the final chapter
3. Map the key turning points chapter by chapter (where their worldview shifted)
4. Identify any arc stall zones (3+ consecutive chapters with no arc movement)
5. Flag if the arc completes too early (character resolved before the final act)
6. Flag if the arc never resolves (open wound with no closure or intentional sequel setup)

Cross-reference with the Live Stat tracking data — do the stat changes match the claimed arc positions?

Output a per-character arc table and flag all stall/completion issues.`));

    steps.push(step(idx++, 'Thematic Cohesion Report', 'analysis', 'analysis',
      `Identify and audit the thematic cohesion of "${title}".

1. State the 2-3 core themes you can identify from the manuscript
2. For each chapter (1-${chapters}), rate: ACTIVE (theme explored), PASSIVE (theme present), SILENT (theme absent), CONTRADICTED (chapter undercuts the theme)
3. Flag any SILENT or CONTRADICTED chapters
4. Verify the Prologue establishes the thematic question
5. Verify the Epilogue answers or consciously leaves open the thematic question
6. Identify the thematic statement (one sentence) the book is making

Flag any chapters that feel thematically disconnected from the rest of the manuscript.`));

    // ── Per-Chapter Passes ─────────────────────────────────────────────────
    // Each pass is a specialist audit targeting a craft dimension the POV
    // checker does NOT cover. All passes inject the corresponding POV check
    // result as context so findings build on each other rather than repeat.

    const startCh = ctx.includePrologue ? 0 : 1;
    const endCh = ctx.includeEpilogue ? chapters + 1 : chapters;

    for (let ch = startCh; ch <= endCh; ch++) {
      const chName = ch === 0 ? 'Prologue' : ch > chapters ? 'Epilogue' : `Chapter ${ch}`;
      const povRef = `\n\n---\n\n## POV Check Reference\nThe POV Quality Gate has already run on this chapter. Its findings (filter words, show/tell violations, pacing score, hook score, plot threads stalled) are available in your context. Use them to avoid duplicating findings and to identify PATTERNS across multiple checks.`;

      // Pass A — Dialogue & Subtext
      steps.push(step(idx++, `${chName} — Dialogue & Subtext`, 'analysis', 'revision_check',
        `Perform a Dialogue & Subtext audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **On-the-nose dialogue**: Flag any exchange where characters say exactly what they mean with no subtext. Quote the specific lines.
2. **Missed subtext opportunities**: Identify 2-3 scenes where the characters are talking AROUND a real issue but the subtext is underdeveloped.
3. **Dialogue tags**: Count non-said tags (hissed, growled, snapped, exclaimed, etc.). Flag if more than 3 are used.
4. **Distinct voice test**: Pick 3 characters who speak in this chapter. Could you identify their lines without the speaker tag? Flag if their voices are indistinguishable.
5. **Information delivery**: Is any exposition being delivered through unnatural dialogue ("As you know, Bob..." syndrome)? Quote the instances.
6. **Silence and action**: Are there moments where a character's silence or physical action does the emotional work instead of words? Note them as strengths.

Output findings with quoted line examples for each issue. Rate dialogue quality 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass B — Tension Architecture
      steps.push(step(idx++, `${chName} — Tension Architecture`, 'analysis', 'revision_check',
        `Perform a Tension Architecture audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Tension map**: Break the chapter into 3-5 scenes/sections. Rate the tension 1-10 at the START and END of each section. Draw the tension arc.
2. **Tension valleys**: Are there sections where the reader could safely put the book down (tension â‰¤4 for more than 500 words)? Flag them.
3. **Cost of conflict**: When the protagonist faces a problem in this chapter, is there a genuine cost to solving it (something lost, a price paid)? Flag any conflict resolved too easily or without consequence.
4. **Hook audit**: Does the chapter's final hook actually CHANGE the story state (new information revealed, threat escalated, relationship shifted)? Or does it end on an emotion without a state change?
5. **False peaks**: Are there moments that feel like they're building to something but deflate without payoff?
6. **Entry/exit discipline**: Does the chapter begin at the last possible moment (in medias res, or immediately at the point of tension)? Does it end at the first moment it can (no cool-down scene after the climax of the chapter)?

Output tension arc table. Flag all valleys and false peaks with chapter position. Rate tension architecture 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass C — Sensory Immersion
      steps.push(step(idx++, `${chName} — Sensory Immersion`, 'analysis', 'revision_check',
        `Perform a Sensory Immersion audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Sense audit**: Scan the chapter for use of all 5 senses. For each sense, note: STRONG (vivid, specific detail), PRESENT (mentioned but generic), ABSENT (not used at all).
   - Visual, Sound, Smell, Touch/Texture, Taste
2. **Dominant sense bias**: Is the chapter entirely visual/dialogue? Flag if 3+ consecutive pages have no sound, smell, or tactile grounding.
3. **Floating head syndrome**: Is the POV character physically present in the scene — do we feel their body, their physical discomfort, their environment through their skin? Or are they a disembodied perspective watching events?
4. **Specificity test**: Pick 5 descriptive phrases. Are they specific and unique to this world/setting, or could they appear in any generic thriller/sci-fi? Flag generic ones.
5. **Atmosphere anchoring**: Is there at least one establishing sensory beat per scene that grounds the reader in where and when they are?

Output sense audit table. Flag floating-head passages with page/paragraph reference. Rate sensory immersion 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass D — Reader Contract
      steps.push(step(idx++, `${chName} — Reader Contract`, 'analysis', 'revision_check',
        `Perform a Reader Contract audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Hook delivery**: Does this chapter deliver on the promise made by the PREVIOUS chapter's hook? If the previous chapter ended on a threat/revelation/cliffhanger, does this chapter address it immediately or delay frustratingly?
2. **Unanswered question pile-up**: List every open question raised in this chapter that wasn't answered. Cross-reference with previous chapters — are any of these questions being raised for the 2nd or 3rd time without progress?
3. **Fair mystery test**: Is any information withheld from the READER that the POV character actually knows? This is an unfair mystery — the reader is being cheated. Flag specific instances.
4. **Setup/payoff audit**: Does this chapter plant any seeds (foreshadowing, Chekhov's guns) that will pay off later? Does it pay off anything planted in earlier chapters? Note both.
5. **Reader expectations**: Based on genre conventions established in the Market Analysis, what will the reader expect at this point in the story? Is the chapter meeting, exceeding, or betraying those expectations?

Output findings with chapter references. Flag unfair mystery instances specifically. Rate reader contract integrity 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass E — Prose Rhythm & Voice
      steps.push(step(idx++, `${chName} — Prose Rhythm & Voice`, 'analysis', 'revision_check',
        `Perform a Prose Rhythm & Voice audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Sentence length variation**: Sample 3 paragraphs. What is the average sentence length? Are sentences monotonously similar in length? Flag if 5+ consecutive sentences are within 2 words of each other.
2. **Purple prose**: Flag any descriptions that are overwritten — where the prose calls attention to itself at the expense of pacing. Quote the worst 2-3 examples.
3. **Crutch phrases**: Identify any words or phrases that appear 3+ times in this chapter that also appeared in previous chapters. These are the author's verbal tics that accumulate into a pattern across the manuscript.
4. **Paragraph rhythm**: Are paragraph breaks being used for emphasis and breath, or are there walls of text that should be broken? Flag paragraphs over 150 words.
5. **Voice consistency**: Is the narrative voice consistent with the POV character's background, education, and emotional state in this chapter? A street-hardened character shouldn't narrate like a poet. A scientist shouldn't miss obvious logical connections. Flag any voice breaks.
6. **Opening line test**: Quote the chapter's first line. Is it a hook? Does it establish voice immediately?

Output findings with quoted examples. Flag crutch phrases with count across the manuscript. Rate prose rhythm 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass F — Character Consistency
      steps.push(step(idx++, `${chName} — Character Consistency`, 'analysis', 'revision_check',
        `Perform a Character Consistency micro-audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Decision consistency**: Does every decision the POV character makes in this chapter follow logically from their established personality, background, and motivation? Flag any moment where they act out of character for plot convenience.
2. **Knowledge boundary**: Does the POV character reference or act on information they shouldn't have at this point in the story? Flag any knowledge leaks (information the character learned later, or that they simply shouldn't know).
3. **Physical continuity**: Do character descriptions match previous chapters — clothing, injuries, items carried, physical condition? Flag any contradictions.
4. **Emotional continuity**: Is the character's emotional state at the START of this chapter consistent with where they were at the END of the previous chapter? Flag jarring emotional resets.
5. **Supporting character behaviour**: Do supporting characters in this chapter behave consistently with their established personalities, allegiances, and knowledge? Flag anyone who acts as a plot puppet rather than a person.
6. **Voice in dialogue**: Does each character's spoken dialogue reflect their established speech patterns and vocabulary? A character who spoke formally in Chapter 1 shouldn't suddenly be casual in Chapter 10 without reason.

Output findings with specific examples quoted from the text. Rate character consistency 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass G — Scene Function
      steps.push(step(idx++, `${chName} — Scene Function`, 'analysis', 'revision_check',
        `Perform a Scene Function audit of ${chName} of "${title}".${povRef}

## Scene Function Rule
Every scene must accomplish at least 2 of these 5 jobs simultaneously:
1. Advance the plot (something changes in the story world)
2. Reveal character (we learn something new or deeper about a character)
3. Establish/deepen world (setting, rules, atmosphere work is done)
4. Create/escalate tension (stakes increase)
5. Deliver theme (the central theme is explored or dramatised)

## Audit Criteria

1. **Scene inventory**: Break the chapter into distinct scenes. For each scene, list which of the 5 jobs it accomplishes.
2. **Single-job scenes**: Flag any scene that only accomplishes 1 job. These are candidates for cutting or merging.
3. **Connective tissue scenes**: Flag purely transitional scenes (character travelling, eating, waking up, arriving somewhere) that accomplish no jobs. These are almost always cuttable.
4. **Scene entrances**: For each scene, does it begin at the last possible moment (conflict or tension already in play) or does it include unnecessary setup/approach?
5. **Scene exits**: Does each scene end at the earliest possible moment after its purpose is served, or does it drag with aftermath?
6. **Cut recommendations**: Based on the above, list any scenes that could be cut or merged with a neighbouring scene without losing story value.

Output scene inventory table. List specific cut/merge recommendations. Rate scene economy 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass H — Rewrite Brief (the action gate)
      steps.push(step(idx++, `${chName} — Revision Brief`, 'analysis', 'revision_check',
        `Synthesise all revision audit findings for ${chName} of "${title}" into a prioritised Rewrite Brief.

You have access in your context to:
- The original chapter text
- The POV Quality Gate findings (filter words, show/tell, pacing, hook scores)
- Passes A through G (dialogue, tension, sensory, reader contract, prose rhythm, character consistency, scene function)

## Your Task

1. **Top 3 Critical Issues**: The 3 findings across ALL passes that would most improve this chapter if fixed. Be specific — quote the problem, describe the fix.
2. **Line-Level Rewrites**: Provide 3-5 specific line-level rewrites for the worst prose offenders.
   CRITICAL RULE: The ORIGINAL text MUST be a 100% VERBATIM string (5-15 words max) copied directly from the source text. Do NOT paraphrase or reconstruct from memory. If it is not exactly verbatim, the automated patcher will fail. Format as:
   - ORIGINAL: [exact verbatim quoted text]
   - REVISED: [your improved version]
   - REASON: [why this is better]
3. **Structural Recommendation**: If the chapter has a scene that should be cut or merged, specify exactly which scene and where its essential content should be relocated.
4. **Final Verdict**:
   - PASS — Minor polish only, no structural work needed. Chapter is fundamentally sound.
   - REVISE — Targeted fixes to specific passages. No scene restructuring required.
   - REWRITE — Structural issues or pervasive craft problems that require a full regeneration with corrective instructions.

OUTPUT FORMAT (you MUST follow this exactly):
**${chName} Revision Brief**
**Critical Issues:**
1. [Issue 1]
2. [Issue 2]
3. [Issue 3]
**Line Rewrites:**
- ORIGINAL: [text] | REVISED: [text] | REASON: [reason]
**Structural Recommendation:** [or "None required"]
Verdict: PASS / REVISE / REWRITE
**Verdict Justification:** [1-2 sentences]`,
        { chapterNumber: ch }));
    }

    // ── Final Revision Summary ─────────────────────────────────────────────

    steps.push(step(idx++, 'Full Revision Summary Report', 'analysis', 'analysis',
      `Compile a complete revision summary report for "${title}" based on all audit passes.

Include:
1. **Manuscript Health Scorecard**: Average scores across all chapters for each pass (Dialogue, Tension, Sensory, Reader Contract, Prose Rhythm, Character Consistency, Scene Function)
2. **Chapter Tier List**: Rank all chapters into 3 tiers: Strong (minimal revision needed), Moderate (targeted revision), Weak (full rewrite recommended)
3. **Cross-Manuscript Patterns**: Identify craft issues that appear in 5+ chapters (systematic problems vs isolated ones)
4. **Crutch Word Master List**: Compile the crutch words/phrases flagged across all Prose Rhythm passes
5. **Priority Action Plan**: Ordered list of the 10 highest-impact changes across the whole manuscript
6. **Estimated Revision Scope**: Given the verdicts, what % of the manuscript needs PASS / REVISE / REWRITE treatment?`));

    return steps;
  },
};


const bookProduction: ProjectTemplate = {
  type: 'book-production',
  name: 'Book Production & Formatting',
  description: 'Final formatting pipeline: prose polish → DOCX/EPUB interior → KDP blurb → export',
  buildSteps: (_ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;

    steps.push(step(idx++, 'Final Prose Polish', 'revision', 'final_edit',
      `Perform a final prose polish on the completed manuscript for "${title}".\n\n` +
      `Focus on:\n` +
      `- Eliminate adverb overuse, passive voice, and crutch phrases\n` +
      `- Tighten dialogue tags (said/asked only where needed)\n` +
      `- Remove accidental repetition of words/phrases within paragraphs\n` +
      `- Ensure scene transitions are smooth\n` +
      `- Verify chapter opening hooks and closing beats\n\n` +
      `Output the polished manuscript with all corrections applied inline.`));

    steps.push(step(idx++, 'Front & Back Matter Generation', 'writing', 'creative_writing',
      `Generate all front and back matter for "${title}".\n\n` +
      `Create:\n` +
      `1. **Copyright page** — standard fiction copyright notice, current year\n` +
      `2. **Dedication** — brief, evocative (1-3 lines)\n` +
      `3. **Epigraph** — if appropriate for the genre, a relevant quote\n` +
      `4. **Author bio** — 150-word third-person bio suitable for Amazon and back cover\n` +
      `5. **"Also By" list** — placeholder for series/other titles\n` +
      `6. **Newsletter CTA** — reader-facing call to action for email list\n` +
      `7. **Acknowledgements** — template the author can fill in\n\n` +
      `Format each section with clear markdown headers.`));

    steps.push(step(idx++, 'KDP Blurb Generation', 'writing', 'creative_writing',
      `Write a compelling Amazon KDP book description (blurb) for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Requirements:\n` +
      `- Hook line (bold, 1-2 sentences that stop the scroll)\n` +
      `- Setup paragraph (establish world, protagonist, stakes)\n` +
      `- Escalation paragraph (complications, impossible choice)\n` +
      `- Tagline/closer (one punchy final line)\n` +
      `- Total length: 1800-2200 characters (KDP sweet spot)\n` +
      `- Use ONLY KDP-allowed HTML: <b>, <i>, <p>, <br>, <ul>, <li>\n` +
      `- Include 3 variants: emotional hook version, mystery/question version, action version\n\n` +
      `Also generate a 400-character "About the book" preview for Amazon search.`));

    steps.push(step(idx++, 'Interior Formatting Spec', 'writing', 'creative_writing',
      `Generate a complete interior formatting specification for "${title}".\n\n` +
      `Include:\n` +
      `- Trim size recommendation for the genre (5Ã—8, 5.5Ã—8.5, or 6Ã—9)\n` +
      `- Font family and size (body, chapter headers, scene breaks)\n` +
      `- Margin specifications (KDP-compliant for page count)\n` +
      `- Chapter opening style (drop cap, extra spacing, ornament)\n` +
      `- Scene break marker style (* * * or ornamental)\n` +
      `- Headers/footers (running headers with title/author)\n` +
      `- First-line indent vs block paragraphs\n\n` +
      `Output as a structured specification the DOCX/EPUB exporter can consume.`));

    return steps;
  },
};

const amazonKdpLaunch: ProjectTemplate = {
  type: 'amazon-kdp-launch',
  name: 'Amazon KDP Launch',
  description: 'Full KDP launch: SCO keywords → GCO categories → metadata → 90-day launch plan',
  buildSteps: (_ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;

    // ── SCO: Search Content Optimization ──
    steps.push(step(idx++, 'SCO — Keyword Research', 'research', 'research',
      `Perform Amazon Search Content Optimization (SCO) keyword research for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Deliver:\n` +
      `1. **Primary keywords** (7 KDP keyword slots):\n` +
      `   - Each keyword/phrase should be 2-4 words, high search volume, low competition\n` +
      `   - Must match reader search intent (what someone types into Amazon search)\n` +
      `   - Avoid single generic words (e.g., "thriller") — use specific phrases\n` +
      `   - Example format: "psychological thriller small town", "unreliable narrator mystery"\n\n` +
      `2. **Long-tail keyword phrases** (20 additional):\n` +
      `   - Phrases readers actually search when looking for this type of book\n` +
      `   - Include "books like [comp title]" style phrases\n` +
      `   - Include trope-based searches ("enemies to lovers sci-fi")\n\n` +
      `3. **Title/Subtitle optimization**:\n` +
      `   - Analyze whether the current title includes searchable terms\n` +
      `   - Suggest subtitle additions that boost discoverability\n` +
      `   - Example: "The Digital Drift: A Multi-POV Science Thriller"\n\n` +
      `4. **Backend keyword strategy**:\n` +
      `   - How to structure the 7 KDP fields for maximum index coverage\n` +
      `   - Which keywords to put in title/subtitle vs backend fields\n` +
      `   - Avoid keyword stuffing flags\n\n` +
      `Research methodology: analyze top 20 comp titles' keywords, Amazon autocomplete suggestions, ` +
      `and "also bought" patterns.`));

    steps.push(step(idx++, 'SCO — Comp Title ASIN Analysis', 'research', 'research',
      `Analyze the top 10 comparable titles for "${title}" on Amazon.\n\n` +
      `For each comp title provide:\n` +
      `- Title, Author, ASIN\n` +
      `- Amazon Best Seller Rank (BSR) and category rankings\n` +
      `- Number of reviews and average rating\n` +
      `- Price point (Kindle, paperback, hardcover)\n` +
      `- Keywords visible in their title/subtitle\n` +
      `- Categories they rank in (visible from their product page)\n` +
      `- Blurb strategy (hook style, length, formatting)\n` +
      `- Cover style observations\n\n` +
      `Synthesize into: what the top sellers have in common, gaps in the market ` +
      `we can exploit, and pricing strategy recommendation.`));

    // ── GCO: Genre Category Optimization ──
    steps.push(step(idx++, 'GCO — Category Strategy', 'research', 'research',
      `Perform Amazon Genre Category Optimization (GCO) for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Deliver:\n` +
      `1. **Primary BISAC categories** (2 for KDP upload):\n` +
      `   - Must be actual Amazon browse categories, not just BISAC codes\n` +
      `   - Select for the best BSR ranking opportunity (smaller niche = easier #1)\n` +
      `   - Format: full category path (e.g., "Kindle Store > Kindle eBooks > Science Fiction & Fantasy > Science Fiction > Hard Science Fiction")\n\n` +
      `2. **Extended category requests** (up to 10 via KDP support):\n` +
      `   - Categories you can request Amazon add your book to via Author Central\n` +
      `   - Prioritized by ranking opportunity and relevance\n` +
      `   - Include the exact category path strings Amazon uses\n\n` +
      `3. **Category competition analysis**:\n` +
      `   - For each recommended category: current #1 BSR, #10 BSR, #50 BSR\n` +
      `   - Estimate of daily sales needed to hit top-10 in each\n` +
      `   - Flag any categories that are too competitive or too irrelevant\n\n` +
      `4. **"New Release" strategy**:\n` +
      `   - Which categories give the longest "Hot New Release" visibility\n` +
      `   - Timing considerations for category ranking vs launch date\n\n` +
      `Goal: maximize visibility with minimal competition.`));

    steps.push(step(idx++, 'GCO — Also-Bought Network Mapping', 'research', 'research',
      `Map the "Also Bought" network for "${title}"'s comp titles.\n\n` +
      `Starting from the top 5 comp titles identified in the ASIN analysis:\n` +
      `1. List their "Customers Also Bought" titles (first 10 each)\n` +
      `2. Identify the cluster pattern — which books appear in multiple "Also Bought" lists\n` +
      `3. Map the genre adjacencies — what neighboring genres do readers cross-shop\n` +
      `4. Identify underserved reader demand — popular "Also Boughts" that are old/unavailable\n\n` +
      `Output:\n` +
      `- Visual network map (text-based) showing title clusters\n` +
      `- Recommended "Also Bought" targets to optimize for\n` +
      `- Ad targeting suggestions based on the network`));

    // ── Metadata & Blurb ──
    steps.push(step(idx++, 'KDP Metadata Package', 'writing', 'creative_writing',
      `Generate the complete KDP metadata package for "${title}".\n\n` +
      `Using the SCO keywords and GCO categories from previous steps, produce:\n\n` +
      `1. **Book title** (optimized with subtitle for search)\n` +
      `2. **Series info** (if applicable)\n` +
      `3. **Book description** (KDP HTML blurb, 1800-2200 chars, using only allowed tags)\n` +
      `4. **7 KDP backend keywords** (final selection, no duplicates with title)\n` +
      `5. **2 primary categories** (exact Amazon paths)\n` +
      `6. **Pricing strategy**: launch price, steady-state price, promo price\n` +
      `7. **Age/grade range** (if applicable)\n` +
      `8. **KDP Select enrollment recommendation** (yes/no with reasoning)\n\n` +
      `Format as a ready-to-paste KDP upload checklist.`));

    steps.push(step(idx++, 'A+ Content / Brand Story', 'writing', 'marketing',
      `Create Amazon A+ Content (Enhanced Brand Content) for "${title}".\n\n` +
      `Design 5 A+ content modules:\n` +
      `1. **Hero image banner** — concept description and headline text\n` +
      `2. **Author spotlight** — bio with pull quote\n` +
      `3. **Book features** — 3 key selling points with icons\n` +
      `4. **Series timeline** — if part of a series, visual progression\n` +
      `5. **Comparison table** — "If you liked X, you'll love Y"\n\n` +
      `For each module, provide the exact text content and image descriptions ` +
      `that can be generated via ComfyUI or sourced from stock.`));

    // ── 90-Day Launch Plan ──
    steps.push(step(idx++, '90-Day Launch Plan', 'outline', 'outline',
      `Create a detailed 90-day launch plan for "${title}" on Amazon KDP.\n\n` +
      `Timeline structure:\n\n` +
      `**Pre-Launch (Day -60 to -1):**\n` +
      `- ARC team assembly and distribution schedule\n` +
      `- Pre-order setup timing and pricing\n` +
      `- Social media content calendar\n` +
      `- Email list warm-up sequence\n` +
      `- BookBub/newsletter promo submissions\n\n` +
      `**Launch Week (Day 0-7):**\n` +
      `- Hour-by-hour launch day checklist\n` +
      `- AMS Sponsored Products campaign setup (keywords from SCO)\n` +
      `- Price pulse strategy (launch price → steady state)\n` +
      `- Review solicitation sequence\n` +
      `- Social proof amplification\n\n` +
      `**Post-Launch (Day 8-90):**\n` +
      `- AMS campaign optimization schedule (7/14/30/60 day reviews)\n` +
      `- Category ranking maintenance tactics\n` +
      `- BookBub Featured Deal application (when eligible)\n` +
      `- Cross-promotion with comp authors\n` +
      `- Read-through optimization for series\n\n` +
      `Include specific AMS bid recommendations and daily budget caps.`));

    steps.push(step(idx++, 'AMS Campaign Blueprints', 'writing', 'marketing',
      `Generate 3 ready-to-launch AMS (Amazon Marketing Services) campaign blueprints for "${title}".\n\n` +
      `**Campaign 1 — Sponsored Products (Automatic):**\n` +
      `- Targeting type: auto\n` +
      `- Daily budget recommendation\n` +
      `- Default bid\n` +
      `- Negative keyword list (prevent wasted spend)\n\n` +
      `**Campaign 2 — Sponsored Products (Manual Keywords):**\n` +
      `- 50 target keywords from the SCO research (broad, phrase, exact match)\n` +
      `- Bid amounts per keyword (tiered by competition)\n` +
      `- Daily budget\n` +
      `- Negative keywords\n\n` +
      `**Campaign 3 — Sponsored Products (ASIN Targeting):**\n` +
      `- 20 target ASINs from comp analysis\n` +
      `- Bid amounts per ASIN\n` +
      `- Category targeting additions\n` +
      `- Daily budget\n\n` +
      `Include a 30-day optimization checklist: which metrics to watch, ` +
      `when to kill underperformers, when to scale winners.`));

    return steps;
  },
};

const shortStory: ProjectTemplate = {
  type: 'short-story',
  name: 'Short Story',
  description: 'Single short story: concept → outline → write → polish',
  buildSteps: (ctx, title, description) => [
    step(1, 'Concept Development', 'premise', 'outline',
      `Develop a compelling concept for the short story "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Include: core premise, protagonist, central conflict, thematic statement, ` +
      `intended emotional impact, and estimated word count (target: ${ctx.estimatedTotalWords || 5000} words).`),
    step(2, 'Story Outline', 'outline', 'outline',
      `Create a beat-by-beat outline for "${title}".\n\n` +
      `Structure: opening hook → rising action (3-4 beats) → climax → ` +
      `denouement → final image/line.\n` +
      `Target: ${ctx.estimatedTotalWords || 5000} words total.`),
    step(3, 'Write Story', 'writing', 'creative_writing',
      `Write the complete short story "${title}" based on the outline.\n\n` +
      `Write the ENTIRE story in full prose. Target: ${ctx.estimatedTotalWords || 5000} words.\n` +
      `Focus on: strong opening hook, tight pacing, vivid sensory detail, ` +
      `and a satisfying ending that resonates.`,
      { wordCountTarget: ctx.estimatedTotalWords || 5000 }),
    step(4, 'Prose Polish', 'revision', 'final_edit',
      `Polish the complete draft of "${title}".\n\n` +
      `Focus on: eliminating weak verbs, tightening dialogue, ` +
      `strengthening the opening and closing lines, and ensuring ` +
      `every scene earns its word count.`),
  ],
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Revision Execution Template
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const revisionExecution: ProjectTemplate = {
  type: 'revision-execution',
  name: 'Revision Execution',
  description: 'Acts on Deep Revision findings: reads Pass H briefs from a parent Deep Revision project and rewrites/patches/polishes each chapter according to its verdict',
  buildSteps: (ctx, title, description) => {
    const chapters = ctx.targetChapters || 25;
    const wordsPerChapter = ctx.targetWordsPerChapter || 3500;
    const steps: ProjectStep[] = [];
    let idx = 1;

    // ── Step 1: Synthesise all Deep Revision findings into an action plan ──
    steps.push(step(idx++, 'Revision Action Plan', 'analysis', 'analysis',
      `You are the Revision Director for "${title}".\n\n` +
      `Your context contains the completed Deep Revision findings from the parent project:\n` +
      `- The Full Revision Summary Report (scorecard, tier list, crutch words, priority actions)\n` +
      `- The Revision Brief (Pass H) for every chapter\n\n` +
      `## Your Task\n\n` +
      `Synthesize all findings into a concrete, prioritised Revision Action Plan.\n\n` +
      `For EACH chapter (${ctx.includePrologue ? 'Prologue, ' : ''}1â€“${chapters}${ctx.includeEpilogue ? ', Epilogue' : ''}), output:\n` +
      `- **Verdict**: REWRITE / REVISE / PASS (taken directly from Pass H)\n` +
      `- **Priority**: HIGH / MEDIUM / LOW (based on overall manuscript impact)\n` +
      `- **Top Issue**: The single most important thing to fix (1 sentence)\n` +
      `- **Action**: What exactly will be done\n\n` +
      `Then output:\n` +
      `- **Execution Order**: Which chapters to tackle first (highest impact, not chapter order)\n` +
      `- **Manuscript-Wide Fixes**: Issues spanning multiple chapters (crutch words, voice breaks, dialogue tics)\n` +
      `- **Risk Flags**: Chapters where a rewrite might destabilise continuity with adjacent chapters\n\n` +
      `Format the chapter table as:\n` +
      `| Chapter | Verdict | Priority | Top Issue | Action |\n` +
      `|---------|---------|----------|-----------|--------|`));

    // ── Per-chapter execution steps ────────────────────────────────────────
    const startCh = ctx.includePrologue ? 0 : 1;
    const endCh = ctx.includeEpilogue ? chapters + 1 : chapters;

    for (let ch = startCh; ch <= endCh; ch++) {
      const chName = ch === 0 ? 'Prologue' : ch > chapters ? 'Epilogue' : `Chapter ${ch}`;

      const actualWords = ctx.chapterWordCounts?.[ch] || wordsPerChapter;
      // Target around 1000-1200 words per segment to prevent LLM truncation,
      // but don't segment very short chapters.
      const segments = Math.max(1, Math.ceil(actualWords / 1200));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `${chName} — Revise Part ${s}` : `${chName} — Execute Revision`;
        
        steps.push(step(idx++, segName, 'revision', 'revision_execution',
          `Execute the revision verdict for ${chName} (Part ${s} of ${segments}) of "${title}".\n\n` +
          `Your context contains:\n` +
          `- The Revision Action Plan (which verdict applies to this chapter)\n` +
          `- The specific Segment ${s} of the original ${chName} prose (from parent project)\n` +
          `- The Pass H Revision Brief for ${chName} (critical issues, line rewrites, structural recommendation)\n` +
          `- All specialist audit findings Aâ€“G\n` +
          `- The POV check findings for ${chName}\n\n` +
          `## Execution Rules\n\n` +
          `FIRST, check the Revision Action Plan to find the Verdict (REWRITE, REVISE, or PASS) for ${chName}. YOU MUST ONLY EXECUTE THE RULES FOR THAT SPECIFIC VERDICT.\n\n` +
          `If the Verdict is REWRITE:\n` +
          `Write a complete fresh version of this segment from scratch. Target word count: ${wordsPerSegment} words minimum. Address ALL critical issues listed in the Revision Brief applicable to this segment. Maintain continuity with preceding parts.\n\n` +
          `If the Verdict is REVISE:\n` +
          `Apply targeted fixes only. Apply the ORIGINAL → REVISED line rewrites from the Revision Brief, and fix the specific passages flagged in the audits. Output the FULL revised segment text with all patches applied inline.\n\n` +
          `If the Verdict is PASS:\n` +
          `Apply light prose polish only. Output the full segment text.\n\n` +
          `CRITICAL INSTRUCTION: You are ONLY revising Part ${s} of ${segments}. Do not attempt to summarize the rest of the chapter. Just revise the segment provided to you.`,
          { wordCountTarget: wordsPerSegment, chapterNumber: ch, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, `${chName} — Compile Revisions`, 'revision', 'revision_compile',
          `Mechanical compilation of all revised segments for ${chName}.`,
          { chapterNumber: ch, totalSegments: segments }));
      }

      // Post-revision POV check — verify no new issues were introduced
      steps.push(step(idx++, `${chName} — Post-Revision Check`, 'analysis', 'pov_check',
        `Verify the revised ${chName} of "${title}" meets quality standards.\n\n` +
        `This is a POST-REVISION check. The chapter has just been rewritten or patched.\n` +
        `Evaluate only what is in front of you now — do NOT compare to the original.\n\n` +
        `OUTPUT FORMAT (follow exactly):\n` +
        `- **POV Character**: [name]\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10]\n` +
        `- **Hook Score**: [1-10]\n` +
        `- **Revision Success**: YES / NO / PARTIAL\n` +
        `- **New Issues Introduced**: [list any NEW problems the revision created, or "None"]\n` +
        `- **Filter Words Found**: [list exact sentences, or "None"]\n` +
        `- **Show vs Tell Violations**: [list passages, or "None"]\n` +
        `- **AI-Isms Found**: [list any Rule of Three, explicit dialogue tags, nominalization, adjective stacking, or participles, or "None"]\n- **Verdict**: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));
    }

    // ── Global manuscript-wide fixes ──────────────────────────────────────
    steps.push(step(idx++, 'Global Manuscript Polish', 'revision', 'manuscript_cleanup',
      `Apply global manuscript-wide fixes for "${title}" identified in the Revision Action Plan.\n\n` +
      `Your context contains:\n` +
      `- The Revision Action Plan (the "Manuscript-Wide Fixes" section)\n` +
      `- The Full Revision Summary's Crutch Word Master List\n\n` +
      `Generate a JSON array of find-and-replace operations to eliminate:\n` +
      `1. Every crutch word/phrase from the master list\n` +
      `2. Repetitive sentence openers identified across multiple chapters\n` +
      `3. Dialogue tics that appear too frequently\n\n` +
      `Output ONLY valid JSON — no markdown wrapping:\n` +
      `[{"old": "exact text to find", "new": "improved replacement"}]`));

    // ── Post-revision continuity check ────────────────────────────────────
    steps.push(step(idx++, 'Post-Revision Continuity Check', 'analysis', 'continuity_check',
      `Perform a continuity check across all revised chapters of "${title}".\n\n` +
      `Focus on NEW contradictions introduced by the revision rewrites — especially chapters\n` +
      `flagged as Risk Chapters in the Revision Action Plan.\n\n` +
      `Check for:\n` +
      `- New contradictions introduced by rewrites\n` +
      `- Timeline integrity across revised chapters\n` +
      `- Character attribute consistency after rewrites\n` +
      `- Plot threads dropped during the rewrite process\n\n` +
      `OUTPUT FORMAT:\n` +
      `If NO issues: "Post-revision continuity check passed. No new contradictions introduced."\n` +
      `If issues found:\n` +
      `### [Issue Number]. [Short Title]\n` +
      `**Contradiction:** [Describe]\n` +
      `**Affected Chapters:** Chapter [N], Chapter [M]\n` +
      `**Suggested Fix:** [Describe the fix]`));

    // ── Final compile ──────────────────────────────────────────────────────
    steps.push(step(idx++, 'Compile Revised Manuscript', 'export', 'export',
      `Compile all revised chapters of "${title}" into the final manuscript.\n\n` +
      `Include all chapters in order: ` +
      `${ctx.includePrologue ? 'Prologue, ' : ''}Chapters 1â€“${chapters}${ctx.includeEpilogue ? ', Epilogue' : ''}.`));

    return steps;
  },
};

const bookCover: ProjectTemplate = {
  type: 'book-cover',
  name: 'Book Cover Design',
  description: 'AI-generated book wrap using FLUX Bookcover LoRA and back-cover text overlay.',
  buildSteps: (ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;
    const variants = ctx.coverVariants || 1;

    steps.push(step(idx++, 'Generate Cover Art Prompt', 'writing', 'book_cover',
      `Generate the final production-ready FLUX.1-dev workflow parameters for a book cover for "${title}".\n\n` +
      `We are using the BOOKCOVER-REDMOND-FLUXKLEIN LoRA, which EXCELS at rendering perfect typography.\n` +
      `Description: ${description}\n\n` +
      `Output a JSON object with these EXACT fields (FLUX.1-dev specific):\n` +
      `{\n` +
      `  "positive_prompt": "detailed cinematic art prompt including EXACT text like: The title \\"${title}\\" is written in bold cinematic typography at the top. The author name \\"By ${ctx.penName || '[Author Name]'}\\" is at the bottom.",\n` +
      `  "negative_prompt": "watermark, blurry, deformed, ugly",\n` +
      `  "backend": "flux",\n` +
      `  "flux_unet": "flux1-dev.safetensors",\n` +
      `  "flux_clip_l": "clip_l.safetensors",\n` +
      `  "flux_clip_t5": "t5xxl_fp16.safetensors",\n` +
      `  "flux_vae": "ae.safetensors",\n` +
      `  "lora_name": "bookcover-redmond-fluxklein.safetensors",\n` +
      `  "lora_strength": 1.0,\n` +
      `  "reference_image": "workspace/images/book1.png", // OPTIONAL: Only if this is a series and you want to match Book 1's style\n` +
      `  "denoise": 0.65, // OPTIONAL: 0.65 for style transfer, omit if no reference image\n` +
      `  "upscale_model": "4x-UltraSharp.pth", // OPTIONAL: Drop this model in ComfyUI/models/upscale_models/ for 4K crispness\n` +
      `  "cfg_scale": 3.5,\n` +
      `  "steps": 28,\n` +
      `  "sampler": "euler",\n` +
      `  "scheduler": "simple",\n` +
      `  "layout": "cover"\n` +
      `}\n\n` +
      `CRITICAL: Output ONLY valid JSON — no markdown, no commentary.`));

    steps.push(step(idx++, 'Generate Back Cover Summary', 'writing', 'book_cover',
      `Write a compelling 150-word back cover blurb for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Make it punchy, high stakes, and end with a hook. Output ONLY the summary paragraphs.`,
      { wordCountTarget: 150 }));

    for (let i = 1; i <= variants; i++) {
      const vLabel = variants > 1 ? ` (Variant ${i})` : '';
      steps.push(step(idx++, `Generate Base Artwork${vLabel}`, 'writing', 'comfyui_generate',
        `Submit the FLUX.1-dev parameters from Step 1 to the local ComfyUI instance ` +
        `and generate the base artwork using the LoRA.\n\n` +
        `This step is handled automatically. No LLM output is required.`));

      steps.push(step(idx++, `Composite Typography${vLabel}`, 'writing', 'text_overlay',
        `Composite the generated back cover summary from Step 2 onto the base artwork from Step ${idx - 2}.\n\n` +
        `This step is handled automatically by the text_overlay engine. No LLM output is required.`));
    }

    return steps;
  },
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Registry
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const TEMPLATES = new Map<string, ProjectTemplate>([
  ['book-planning', bookPlanning],
  ['style-calibration', styleCalibration],
  ['novel-pipeline', novelPipeline],
  ['deep-revision', deepRevision],
  ['revision-execution', revisionExecution],
  ['book-production', bookProduction],
  ['amazon-kdp-launch', amazonKdpLaunch],
  ['short-story', shortStory],
  ['book-cover', bookCover],
]);

export class TemplateRegistry {
  /** Get a template by type name. */
  get(type: string): ProjectTemplate | undefined {
    return TEMPLATES.get(type);
  }

  /** List all available templates. */
  list(): ProjectTemplate[] {
    return Array.from(TEMPLATES.values());
  }

  /** Register a custom template. */
  register(template: ProjectTemplate): void {
    TEMPLATES.set(template.type, template);
  }
}

