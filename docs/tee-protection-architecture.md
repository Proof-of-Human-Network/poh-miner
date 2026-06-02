# TEE (Trusted Execution Environment) for Inference Work Protection

## Context
In the PoH Miner Network we want strong guarantees that a miner actually ran the full POH checker + brain inference on the required signals, instead of faking results or only running a few signals.

Current protection (software level):
- `methodsHash` verification
- Minimum 75% of live signals must be evaluated
- Require full output (verdict + profile + reasoning)
- Reputation + slashing based on invalid submissions

## Can We Use TEE for Stronger Protection?

**Short answer:** Yes, it is possible and would give significantly stronger guarantees, but it is **not trivial** for this workload.

### What TEE Would Give Us
- Remote attestation: the network (or other miners) can cryptographically verify that a specific piece of code ran inside a genuine TEE with the correct inputs.
- Confidentiality + integrity of the inference execution (even the host OS / cloud provider cannot tamper with or observe the computation).
- The miner could produce an **attestation quote** together with the `ScanResult`, proving "this exact binary with this exact signals list produced this output".

### Challenges Specific to This Project

1. **Workload Complexity**
   - The current inference stack is:
     - Node.js application
     - `runFullCheck` (hundreds of on-chain RPC calls + labeled lists + graph analysis)
     - Ollama (local LLM server) for the brain verdict
   - Most TEEs (especially Intel SGX) have very limited memory (~128MB EPC in older versions) and poor/no direct GPU access.
   - Running a full Ollama instance inside an SGX enclave is extremely difficult.

2. **Hardware Availability on Target Devices**
   - Target operators: Raspberry Pi, Mac Mini (M-series), mini-PCs, cheap VPS, gaming PCs, servers, etc.
   - Raspberry Pi → No modern TEE.
   - Consumer AMD/Intel CPUs → SEV-SNP or SGX (SGX is deprecated on many consumer chips).
   - Apple Silicon → No equivalent public TEE for third-party code.
   - Cheap VPS → Almost never have confidential computing enabled.

3. **Attestation & Key Management**
   - Need to manage attestation verification (IAS/DCAp for SGX, AMD KDS for SEV, etc.).
   - Miners would need to register their enclave measurements (MRENCLAVE).
   - The network needs a way to trust the attestation service.

4. **Developer & Operational Complexity**
   - Enclave development is painful (especially SGX with Gramine or Occlum).
   - Debugging inside TEEs is hard.
   - Frequent updates to the checker/brain logic would require new enclave measurements and re-attestation.

### More Practical TEE / Confidential Computing Options (Ranked)

| Option                        | Feasibility for this project | Notes |
|-------------------------------|------------------------------|-------|
| **AWS Nitro Enclaves**        | Medium-High (for operators who run on AWS) | Easier than SGX, good for server-side miners. Can run containers. |
| **AMD SEV-SNP (Confidential VMs)** | Medium | Works on modern EPYC. Can run full VMs. Better for GPU? Still limited. |
| **Intel TDX**                 | Medium | Newer than SGX, full VM level. |
| **Gramine + SGX**             | Low-Medium | Possible but painful for Node.js + Ollama. |
| **Nitro + custom inference**  | High if we move brain to a smaller model runnable in enclave | Could run a distilled model inside the enclave. |
| **Full ZKML (future)**        | Very High long-term | Instead of TEE, prove the inference in zero-knowledge. Still early for LLMs. |

### Recommended Path (If We Want Stronger Protection)

**Short/Medium term (better than pure software, realistic):**
1. Make the **work validation** more sophisticated on the software level first (multiple independent miners must agree on the same result for high-value scans, statistical sampling, etc.).
2. For operators who want to run "trusted miners", offer an optional **Nitro Enclave** or **SEV-SNP VM** image that runs a hardened version of the miner.
3. Require attestation quote (when available) as an optional field in `ScanResult`. Nodes with valid attestation get higher reputation / priority.

**Longer term:**
- Investigate running a smaller, reproducible inference model inside a confidential VM / enclave.
- Explore moving parts of the signal evaluation into something that can be proven (or at least attested).

## Conclusion

**Can we do it?**  
Yes — TEEs can provide much stronger protection than software checks alone.

**Should we do it right now?**  
Probably not as the primary solution, because:
- Target hardware diversity is too high.
- The current inference stack is too heavy for most TEEs.
- Development and operational cost is very high.

**Best current strategy:**
Software + economic protections (what we're building) + optional TEE path for high-trust operators, with clear documentation of the trade-offs.

This document should be referenced when we design the final work verification + slashing system.
