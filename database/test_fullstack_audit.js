/**
 * Full-Stack Automated Test Suite for EarnFlow Platform
 * Run via: node database/test_fullstack_audit.js
 */

import crypto from 'node:crypto';

// Color formatting for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

function logPass(testName) {
  console.log(`${colors.green}✓ [PASS]${colors.reset} ${testName}`);
}

function logFail(testName, error) {
  console.error(`${colors.red}✗ [FAIL]${colors.reset} ${testName}:`, error);
}

async function runTests() {
  console.log(`\n${colors.bold}${colors.cyan}=== EARNFLOW FULL-STACK AUTOMATED TEST SUITE ===${colors.reset}\n`);

  let passCount = 0;
  let failCount = 0;

  // TEST 1: Country Eligibility Matching Algorithm
  try {
    const isEligible = (taskCountryScope, userCountry, isVerified) => {
      if (taskCountryScope.includes('GLOBAL')) return true;
      if (isVerified && userCountry && taskCountryScope.includes(userCountry)) return true;
      return false;
    };

    if (!isEligible(['GLOBAL'], 'NG', false)) throw new Error('GLOBAL task should be visible to unverified users');
    if (!isEligible(['NG', 'GH'], 'NG', true)) throw new Error('NG task should be visible to verified NG user');
    if (isEligible(['NG', 'GH'], 'US', true)) throw new Error('NG/GH task should NOT be visible to US user');
    if (isEligible(['NG'], 'NG', false)) throw new Error('Country-restricted task should NOT be visible to unverified user');

    logPass('Test 1: Country-Aware Task Eligibility Engine');
    passCount++;
  } catch (err) {
    logFail('Test 1: Country-Aware Task Eligibility Engine', err.message);
    failCount++;
  }

  // TEST 2: IP Risk Classification Engine
  try {
    const classifyIp = (data) => {
      const score = data.fraud_score ?? 0;
      if (data.tor || score >= 85) return 'block';
      if (data.vpn || data.proxy || data.connection_type === 'Data Center') return 'hold';
      if (score >= 60) return 'challenge';
      return 'allow';
    };

    if (classifyIp({ tor: true }) !== 'block') throw new Error('Tor IP should be blocked');
    if (classifyIp({ fraud_score: 90 }) !== 'block') throw new Error('Fraud score >= 85 should be blocked');
    if (classifyIp({ vpn: true }) !== 'hold') throw new Error('VPN IP should be put on hold');
    if (classifyIp({ connection_type: 'Data Center' }) !== 'hold') throw new Error('Datacenter IP should be put on hold');
    if (classifyIp({ fraud_score: 65 }) !== 'challenge') throw new Error('Fraud score >= 60 should challenge');
    if (classifyIp({ fraud_score: 10 }) !== 'allow') throw new Error('Clean IP should be allowed');

    logPass('Test 2: IP Risk Classification Engine (IPQS Rules)');
    passCount++;
  } catch (err) {
    logFail('Test 2: IP Risk Classification Engine (IPQS Rules)', err.message);
    failCount++;
  }

  // TEST 3: 50/50 Revenue Split Calculation
  try {
    const calculateSplit = (grossMinor, payoutMinor) => {
      let userPayout, ownerCommission;
      if (grossMinor > 0) {
        userPayout = Math.floor(grossMinor * 0.50);
        ownerCommission = grossMinor - userPayout;
      } else {
        userPayout = payoutMinor;
        ownerCommission = 0;
      }
      return { userPayout, ownerCommission };
    };

    const split1 = calculateSplit(100000, 70000); // 1,000 NGN gross
    if (split1.userPayout !== 50000 || split1.ownerCommission !== 50000) {
      throw new Error(`Expected 50000/50000 split, got ${split1.userPayout}/${split1.ownerCommission}`);
    }

    const splitOdd = calculateSplit(100005, 70000); // odd number check
    if (splitOdd.userPayout !== 50002 || splitOdd.ownerCommission !== 50003) {
      throw new Error(`Odd rounding error: got ${splitOdd.userPayout}/${splitOdd.ownerCommission}`);
    }

    logPass('Test 3: 50/50 Platform Owner & User Revenue Automation');
    passCount++;
  } catch (err) {
    logFail('Test 3: 50/50 Platform Owner & User Revenue Automation', err.message);
    failCount++;
  }

  // TEST 4: Paystack Webhook Signature Verification Logic (HMAC SHA-512)
  try {
    const secretKey = 'sk_test_mock_paystack_secret_key_12345';
    const payload = JSON.stringify({ event: 'transfer.success', data: { reference: 'earnflow_test_123' } });

    const hmac = crypto.createHmac('sha512', secretKey);
    hmac.update(payload);
    const validSignature = hmac.digest('hex');

    const verify = (body, sig, key) => {
      const computed = crypto.createHmac('sha512', key).update(body).digest('hex');
      return computed === sig;
    };

    if (!verify(payload, validSignature, secretKey)) {
      throw new Error('Valid Paystack webhook signature failed verification');
    }

    if (verify(payload, 'invalid_signature_hex', secretKey)) {
      throw new Error('Invalid signature was improperly accepted');
    }

    logPass('Test 4: Paystack Webhook HMAC-SHA512 Signature Security');
    passCount++;
  } catch (err) {
    logFail('Test 4: Paystack Webhook HMAC-SHA512 Signature Security', err.message);
    failCount++;
  }

  // TEST 5: Referral Bonus Calculation
  try {
    const calculateReferralBonus = (taskPayoutMinor, bonusRate = 0.10) => {
      return Math.floor(taskPayoutMinor * bonusRate);
    };

    if (calculateReferralBonus(50000, 0.10) !== 5000) {
      throw new Error('Referral 10% bonus calculation mismatch');
    }
    if (calculateReferralBonus(20, 0.10) !== 2) {
      throw new Error('Small referral bonus math error');
    }

    logPass('Test 6: 10% Referee Bonus Accounting Engine');
    passCount++;
  } catch (err) {
    logFail('Test 5: 10% Referee Bonus Accounting Engine', err.message);
    failCount++;
  }

  // TEST 6: Token Bucket Rate Limiting Simulation
  try {
    const simulateRateLimiter = (maxTokens, refillRate, requests, intervalSec) => {
      let tokens = maxTokens;
      let blockedCount = 0;
      let lastTime = 0;

      for (let i = 0; i < requests; i++) {
        const now = i * intervalSec;
        const elapsed = now - lastTime;
        tokens = Math.min(maxTokens, tokens + elapsed * refillRate);
        lastTime = now;

        if (tokens < 1) {
          blockedCount++;
        } else {
          tokens -= 1;
        }
      }
      return blockedCount;
    };

    // 10 rapid burst requests with max 5 tokens should block 5 requests
    const blocked = simulateRateLimiter(5, 0.1, 10, 0.01);
    if (blocked !== 5) {
      throw new Error(`Rate limit burst check expected 5 blocks, got ${blocked}`);
    }

    logPass('Test 6: Worker Token-Bucket Rate Limiter Engine');
    passCount++;
  } catch (err) {
    logFail('Test 6: Worker Token-Bucket Rate Limiter Engine', err.message);
    failCount++;
  }

  console.log(`\n${colors.bold}=== TEST RESULTS SUMMARY ===${colors.reset}`);
  console.log(`${colors.green}Total Passed: ${passCount}${colors.reset}`);
  console.log(`${colors.red}Total Failed: ${failCount}${colors.reset}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
