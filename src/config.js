export const GAME_DURATION = 75;
export const FRISBEE_DURATION = 40;
export const MAX_LIVES = 3;
export const HIT_INVINCIBLE_SECONDS = 1.2;
export const SHIELD_SECONDS = 5;
export const MAX_HEART_SPAWNS = 2;
export const PUDDLE_SLOW_SECONDS = 0.9;
export const ENABLE_DEBUG_TOOLS = true;

export const PHASES = [
  { end: 15, speed: 250, gap: 1.05, templates: ['single', 'bones'] },
  { end: 40, speed: 290, gap: 0.9, templates: ['single', 'bones', 'double'] },
  { end: 65, speed: 335, gap: 0.78, templates: ['single', 'bones', 'double', 'switch', 'hazards'] },
  { end: 75, speed: 335, gap: 0.86, templates: ['bones', 'reward'] },
];

export const COLORS = {
  sky: '#dff3f5',
  cloud: '#ffffff',
  grass: '#c9e6a8',
  grassDark: '#91bd70',
  road: '#f6e8c8',
  roadEdge: '#b9c79d',
  ink: '#493426',
  cream: '#fff9e9',
  bone: '#fff9df',
  boneEdge: '#d9cdb0',
  brown: '#87522f',
  dog: '#d98b45',
  dogDark: '#8d522d',
  red: '#ed665f',
  yellow: '#f4c84c',
  blue: '#9fbd7e',
};
