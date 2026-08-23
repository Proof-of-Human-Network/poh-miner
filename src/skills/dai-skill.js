/**
 * dai_identity skill — wraps the existing checker.runFullCheck() pipeline.
 * Registered as the built-in skill in SkillsRegistry.
 */

export const DAI_SKILL_MANIFEST = {
  id: 'dai_identity',
  version: '1.0.0',
  author: 'dai_protocol',
  description: 'Decentralized Artificial Intelligence identity verification using on-chain signals and AI brain',
  inputSchema: { address: 'string', chains: 'string[]' },
  outputSchema: { verdict: 'string', confidence: 'number', reasoning: 'string', signalsUsed: 'object[]' },
  stateId: 'dai_brain',
  allowedEndpoints: ['*'],
};

export async function run(input, config, sharedState) {
  // Delegates entirely to the existing computeVerdictWithExistingDai adapter.
  // sharedState provides the live dai brain/checker — no duplication.
  const { computeVerdictWithExistingDai } = await import('../compute/dai-adapter.js');
  return computeVerdictWithExistingDai(input, config, sharedState);
}
