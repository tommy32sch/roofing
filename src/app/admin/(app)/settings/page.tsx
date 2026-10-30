import { redirect } from 'next/navigation';
import { SETTINGS_DEFAULT_HREF } from '@/lib/settings/sections';

export default function SettingsIndexPage() {
  redirect(SETTINGS_DEFAULT_HREF);
}
