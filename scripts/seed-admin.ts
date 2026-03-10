/**
 * Seed script to create an initial admin user
 * Run with: npx tsx scripts/seed-admin.ts
 */

import { createClient } from '@supabase/supabase-js';
import { hash } from 'bcryptjs';

async function seedAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const name = process.env.ADMIN_NAME || 'Admin User';

  console.log(`Creating admin user: ${email}`);

  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    console.log('Admin user already exists');
    process.exit(0);
  }

  const passwordHash = await hash(password, 12);

  const { error } = await supabase
    .from('admin_users')
    .insert({
      email,
      password_hash: passwordHash,
      name,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }

  console.log('Admin user created successfully!');
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log('\nIMPORTANT: Change these credentials in production!');
}

seedAdmin().catch(console.error);
