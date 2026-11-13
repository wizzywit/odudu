import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export const PROFILE: SettingsSection = {
  id: 'profile',
  title: 'Profile',
  description:
    'What the Complete the profile action needs a person to have before it ends. The page lists every field a person can edit and marks these; the others stay optional.',
  fields: [
    {
      name: 'required_profile_fields',
      label: 'Required profile fields',
      control: 'set',
      description:
        'Choose none and the page is only reviewed and submitted. Full name or given and family name are the usual ones to ask for.',
      options: [
        { id: 'name', label: 'Full name' },
        { id: 'given_name', label: 'Given name' },
        { id: 'family_name', label: 'Family name' },
        { id: 'middle_name', label: 'Middle name' },
        { id: 'nickname', label: 'Nickname' },
        { id: 'preferred_username', label: 'Preferred username' },
        { id: 'profile', label: 'Profile page' },
        { id: 'picture', label: 'Picture address' },
        { id: 'website', label: 'Website' },
        { id: 'gender', label: 'Gender' },
        { id: 'birthdate', label: 'Birthdate' },
        { id: 'zoneinfo', label: 'Time zone' },
        { id: 'locale', label: 'Language' },
        { id: 'phone_number', label: 'Phone number' },
        { id: 'address_formatted', label: 'Address' },
        { id: 'address_street', label: 'Street' },
        { id: 'address_locality', label: 'City' },
        { id: 'address_region', label: 'Region' },
        { id: 'address_postal_code', label: 'Postal code' },
        { id: 'address_country', label: 'Country' },
      ],
    },
  ],
};
