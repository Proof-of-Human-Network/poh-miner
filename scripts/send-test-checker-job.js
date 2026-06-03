#!/usr/bin/env node
/**
 * Send a test "verdict" job (checker request) to ANY running miner.
 *
 * This exercises the real POH checker (runFullCheck + brain + network signals)
 * on a miner that is already running (Electron app, `node start.js`, etc.).
 *
 * Usage:
 *   # Send to a miner already running on the default port
 *   node scripts/send-test-checker-job.js
 *   node scripts/send-test-checker-job.js bc1qsomeaddress123
 *
 *   # Explicitly target a specific miner (useful when you have multiple)
 *   node scripts/send-test-checker-job.js bc1q... --target http://localhost:3456
 *   node scripts/send-test-checker-job.js bc1q... --target=http://localhost:3456
 *   TARGET=http://192.168.1.50:3456 node scripts/send-test-checker-job.js
 */

import http from 'http';

const targetAddress = process.argv[2] || 'bc1qtestcheckeraddressforpoh';
let targetArg = process.argv.find(a => a.startsWith('--target='));
if (!targetArg) {
  const idx = process.argv.indexOf('--target');
  if (idx !== -1 && process.argv[idx + 1]) targetArg = '--target=' + process.argv[idx + 1];
}
const TARGET = targetArg ? targetArg.split('=')[1] : (process.env.TARGET || 'http://localhost:3456');

console.log('\n🧪 PoH Miner - Test Checker Job Sender (Any Miner)\n');
console.log(`Target address : ${targetAddress}`);
console.log(`Target miner   : ${TARGET}\n`);

console.log('Equivalent curl you can copy-paste (legacy /test/job or new /job for status+result flow):');
console.log(`curl -X POST ${TARGET.replace(/\/$/, '')}/job \\
  -H "Content-Type: application/json" \\
  -d '{
    "payload": { "address": "${targetAddress}" }
  }'
`);
console.log(`# Then: curl ${TARGET.replace(/\/$/, '')}/job/<jobId>/status`);
console.log(`# And:  curl ${TARGET.replace(/\/$/, '')}/job/<jobId>/result  (verdict + profile + evidence)`);
console.log('');

console.log('Note: If you get {"error":"Not found"}, your running miner is an old version.');
console.log('      Quit + restart the PoH Miner (Electron or CLI) to load the /test/job handler.\n');

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  const job = {
    id: `test-checker-${Date.now()}`,
    type: 'verdict',
    payload: {
      address: targetAddress,
    },
    fee: 25_000_000,
    originCountry: 'US',
    createdAt: Date.now(),
  };

  const endpoint = `${TARGET.replace(/\/$/, '')}/test/job`;

  console.log(`📨 Sending test verdict job to ${endpoint} ...\n`);
  console.log(JSON.stringify(job, null, 2));

  let usedHttp = false;

  try {
    const result = await postJson(endpoint, job);

    if (result.status >= 200 && result.status < 300) {
      usedHttp = true;
      console.log('\n✅ Job accepted by the miner via /test/job!');
      console.log(result.data);
      console.log('\nCheck the target miner\'s logs — you should see the checker (runFullCheck) executing.');
      console.log('The result will appear in its submissionHistory and (if valid) in the next block it produces.');
    } else if (result.status === 404 && result.data && result.data.error === 'Not found') {
      console.error('\n⚠️  Target miner returned "Not found" for /test/job.');
      console.error('   This usually means the running miner is an older version that doesn\'t have the test endpoint yet.');
      console.error('   (You need to restart the PoH Miner / Electron app so it loads the updated src/miner-node.js)');
      throw new Error('endpoint not available');
    } else {
      console.error(`\n❌ Miner returned status ${result.status}`);
      console.error(result.data);
      throw new Error('bad response');
    }
  } catch (err) {
    if (usedHttp) {
      // already handled
    } else {
      console.log('\n🔄 Falling back to starting a local miner and running the job internally (this will still execute the real checker)...\n');

      try {
        // Dynamic import so we don't require the module if HTTP succeeded
        const { PohMinerNode } = await import('../src/miner-node.js');

        const miner = new PohMinerNode({
          wallet: `test-checker-sender-${Date.now().toString(36)}`,
          computeEnabled: true,
          inferenceMode: 'cpu',
        });

        console.log('Starting local test miner...');
        await miner.start();

        // small delay for methods/checker to load
        await new Promise(r => setTimeout(r, 1200));

        console.log('\n📨 Submitting job directly to local miner\'s job queue + compute path...\n');

        if (miner.jobQueue) {
          miner.jobQueue.addJob(job);
        }

        await miner.computeAndSubmitJob(job);

        // give it time to record
        await new Promise(r => setTimeout(r, 1500));

        const history = miner.submissionHistory || [];
        const ourResult = history.find(r => r.requestId === job.id || r.address === targetAddress);

        if (ourResult) {
          console.log('\n✅ Checker job completed via fallback! Result:');
          console.dir({
            requestId: ourResult.requestId,
            address: ourResult.address,
            verdict: ourResult.verdict,
            confidence: ourResult.confidence,
            realPohUsed: ourResult.realPohUsed,
            signalsUsed: ourResult.signalsUsed,
            methodsHash: ourResult.methodsHash,
            computationTimeMs: ourResult.computationTimeMs,
          }, { depth: 2 });
        } else {
          console.log('\n⚠️  Job submitted, but no result seen in submissionHistory yet. Check the logs above for "Computing verdict" / checker output.');
        }

        console.log('\nPress Ctrl+C to stop the local test miner.\n');
        process.stdin.resume();
        return; // keep alive
      } catch (fallbackErr) {
        console.error('\n❌ Both HTTP submission and local fallback failed:');
        console.error(fallbackErr.message || fallbackErr);
      }
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
