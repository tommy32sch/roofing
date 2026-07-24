-- Where each office actually is on the map.
--
-- The map fits its view to the leads it is showing, which works right up until
-- a market has no leads yet: switching to Minnesota left the map sitting over
-- Phoenix, because there was nothing to fit to. A market needs a home position
-- of its own, independent of whether any leads have been imported for it.
--
-- Stored rather than geocoded on demand so switching markets is instant and
-- can't fail: a Nominatim lookup at click time would add a second of latency
-- and silently leave the map put whenever it errored or rate-limited.

ALTER TABLE markets ADD COLUMN center_lat DOUBLE PRECISION;
ALTER TABLE markets ADD COLUMN center_lng DOUBLE PRECISION;
-- Roughly metro-wide. Null falls back to the map's own default.
ALTER TABLE markets ADD COLUMN center_zoom INTEGER;

UPDATE markets SET center_lat = 33.4484, center_lng = -112.0740, center_zoom = 10
WHERE name = 'Arizona';

UPDATE markets SET center_lat = 44.9778, center_lng = -93.2650, center_zoom = 10
WHERE name = 'Minnesota';
