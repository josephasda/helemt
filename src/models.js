// Helmet models offered in step 1 of the configurator.
//
// File-based models live in /public/models and are loaded by URL. Licensed
// models must NOT be committed to a public repository (see .gitignore) — copy
// them into public/models on your machine or in your hosting build instead.
// A model whose file is missing is simply hidden, and the built-in procedural
// helmet is always available as a fallback.
//
// rotationY (radians) turns a model so its face points along +Z.
export const MODELS = [
  {
    id: 'race-pro',
    name: 'Race Pro',
    note: 'Full-face race helmet · aero spoiler · chin vents',
    url: '/models/helmet.glb',
    rotationY: Math.PI, // this model is authored facing -Z
  },
  {
    id: 'gp-r',
    name: 'GP-R Track',
    note: 'Built-in track shell · integrated spoiler · 5 vents',
    procedural: true,
  },
];
