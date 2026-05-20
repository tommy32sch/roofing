INSERT INTO lead_sources (name, display_name, sort_order) VALUES
  ('cold_call', 'Cold Call', 11)
ON CONFLICT (name) DO NOTHING;
