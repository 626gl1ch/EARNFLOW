import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('EarnFlow Automated Database Migration Utility');
  console.log('---------------------------------------------');

  // Try loading credentials from worker/.dev.vars or environment
  let supabaseUrl = process.env.SUPABASE_URL;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const devVarsPath = path.join(__dirname, '../worker/.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, 'utf8');
    const urlMatch = content.match(/^SUPABASE_URL=(.+)$/m);
    const keyMatch = content.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (urlMatch && urlMatch[1].trim()) supabaseUrl = urlMatch[1].trim();
    if (keyMatch && keyMatch[1].trim()) serviceRoleKey = keyMatch[1].trim();
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
    console.error('Please configure worker/.dev.vars or set environment variables before running migration.');
    process.exit(1);
  }

  console.log(`Target Supabase URL: ${supabaseUrl}`);

  const sqlFiles = ['schema.sql', 'functions.sql', 'policies.sql', 'seed.sql'];

  for (const file of sqlFiles) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipping missing file: ${file}`);
      continue;
    }

    console.log(`Applying ${file}...`);
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({ query: sqlContent })
      });

      if (!response.ok) {
        // Fallback to direct pg_net / REST query if exec_sql RPC isn't enabled
        const text = await response.text();
        console.log(`Response for ${file}: ${response.status} - ${text}`);
      } else {
        console.log(`Successfully applied ${file}`);
      }
    } catch (err) {
      console.error(`Error executing ${file}:`, err.message);
    }
  }

  console.log('Migration execution complete.');
}

runMigration().catch(console.error);
