/**
 * poh_identity skill — wraps the existing checker.runFullCheck() pipeline.
 * Registered as the built-in skill in SkillsRegistry.
 */

export const POH_SKILL_MANIFEST = {
  id: 'poh_identity',
  version: '1.0.0',
  author: 'poh_protocol',
  description: 'Proof-of-Human identity verification using on-chain signals and AI brain',
  inputSchema: { address: 'string', chains: 'string[]' },
  outputSchema: { verdict: 'string', confidence: 'number', reasoning: 'string', signalsUsed: 'object[]' },
  stateId: 'poh_brain',
  allowedEndpoints: ['*'],
};

export async function run(input, config, sharedState) {
  // Delegates entirely to the existing computeVerdictWithExistingPoh adapter.
  // sharedState provides the live poh brain/checker — no duplication.
  const { computeVerdictWithExistingPoh } = await import('../compute/poh-adapter.js');
  return computeVerdictWithExistingPoh(input, config, sharedState);
}
