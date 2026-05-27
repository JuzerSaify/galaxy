// Polyfill global WebSocket for older Node environments inside Electron main process
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = class {};
}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://xhyocyifhugpyqvmwrne.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoeW9jeWlmaHVncHlxdm13cm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDg4MDEsImV4cCI6MjA5NTM4NDgwMX0.InqCT8evlNdTvzkSh3UpJIivORyZk-Pwbh4kBYuPalQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false // We will handle persistence manually via electron-store for maximum control
  }
});

module.exports = supabase;
