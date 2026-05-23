import type { ProjectStep, ProjectContext, ProjectTemplate } from '@perry/core';

function step(
  index: number,
  label: string,
  phase: string,
  taskType: string,
  prompt: string,
  opts?: {
    wordCountTarget?: number;
    chapterNumber?: number;
    segmentIndex?: number;
    totalSegments?: number;
    networkRequests?: ProjectStep['networkRequests'];
  },
): ProjectStep {
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
    networkRequests: opts?.networkRequests,
  };
}

const dndCampaignPlanning: ProjectTemplate = {
  type: 'dnd-campaign-planning',
  workType: 'dnd',
  name: 'D&D Campaign Planning',
  description: 'Plan a D&D campaign: worldbuilding, faction alignment, campaign arc, and Session 0 prep.',
  buildSteps: (ctx: ProjectContext, title: string, description: string) => {
    return [
      step(1, 'Worldbuilding & Lore', 'planning', 'creative_writing',
        `Based on the campaign concept: ${title}\n\nDescription: ${description}\n\nCreate a worldbuilding document outlining the cosmology, geography, history, and key factions of the campaign setting.`),
      step(2, 'Faction & NPC Alignment', 'planning', 'creative_writing',
        `Outline the major factions in the campaign, their leaders, agendas, resources, and relationship with other groups.`),
      step(3, 'Campaign Story Arc Outline', 'planning', 'creative_writing',
        `Outline the main story arc of the campaign, including starting hooks, tier-based milestones, major climaxes, and possible endings.`),
      step(4, 'Session 0 Prep Guide', 'planning', 'creative_writing',
        `Draft a Session 0 checklist for the DM, covering character creation guidelines, safety tools, house rules, and campaign expectations.`)
    ];
  }
};

const dndSessionPrep: ProjectTemplate = {
  type: 'dnd-session-prep',
  workType: 'dnd',
  name: 'D&D Session Prep',
  description: 'Prepare an upcoming D&D session: recap, locations, encounters, and rewards.',
  buildSteps: (ctx: ProjectContext, title: string, description: string) => {
    return [
      step(1, 'Recap & Narrative Hook', 'planning', 'creative_writing',
        `Summarize the events of the previous session and write the opening narrative hook / description for the start of the next session.`),
      step(2, 'Key Locations & NPCs', 'writing', 'creative_writing',
        `Detail the primary locations the party is likely to visit during this session, and describe the key NPCs they may interact with (personality, appearance, secrets).`),
      step(3, 'Combat & Hazard Encounters', 'writing', 'creative_writing',
        `Design 2-3 balanced combat encounters or environmental hazards appropriate for the party level. Include monster tactics, environment layout, and DC checks.`),
      step(4, 'Treasure & Rewards', 'verification', 'creative_writing',
        `Specify the loot, magical items, or narrative secrets the party can discover or win during the session, with item descriptions and lore.`)
    ];
  }
};

const dndCharacterDesign: ProjectTemplate = {
  type: 'dnd-character-design',
  workType: 'dnd',
  name: 'D&D Character Design',
  description: 'Design a player character or major NPC: concept, backstory, and roleplay/voice guidelines.',
  buildSteps: (ctx: ProjectContext, title: string, description: string) => {
    return [
      step(1, 'Character Concept & Stats', 'planning', 'creative_writing',
        `Design the mechanics and core concept of a character (race, class, subclass, ability scores, background, and unique abilities).`),
      step(2, 'Backstory & Motivation', 'writing', 'creative_writing',
        `Write a detailed character backstory highlighting how they fits into the world, their family/bonds, conflicts, flaws, and motivation for adventuring.`),
      step(3, 'Roleplay & Voice Guidelines', 'verification', 'creative_writing',
        `Draft guidelines for playing this character, including voice descriptors, speech patterns, catchphrases, moral alignment, and typical reactions to common scenarios.`)
    ];
  }
};

export const dndTemplates: ProjectTemplate[] = [
  dndCampaignPlanning,
  dndSessionPrep,
  dndCharacterDesign
];
