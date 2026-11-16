import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export const PROFILE: SettingsSection = {
  id: 'profile',
  title: 'Profile',
  description:
    'What a person has to fill in before the Complete the profile step of their sign-in ends. The page lists every field a person can edit and marks these; the others stay optional.',
  fields: [
    {
      name: 'required_profile_fields',
      label: 'Required profile fields',
      control: 'set',
      description:
        'Choose none and the page is only reviewed and submitted. Full name or given and family name are the usual ones to ask for.',
      options: [
        { id: 'name', group: 'Name', label: 'Full name' },
        { id: 'given_name', group: 'Name', label: 'Given name' },
        { id: 'family_name', group: 'Name', label: 'Family name' },
        { id: 'middle_name', group: 'Name', label: 'Middle name' },
        { id: 'nickname', group: 'Name', label: 'Nickname' },
        { id: 'preferred_username', group: 'Name', label: 'Preferred username' },
        { id: 'profile', group: 'On the web', label: 'Profile page' },
        { id: 'picture', group: 'On the web', label: 'Picture address' },
        { id: 'website', group: 'On the web', label: 'Website' },
        { id: 'gender', group: 'About the person', label: 'Gender' },
        { id: 'birthdate', group: 'About the person', label: 'Birthdate' },
        { id: 'zoneinfo', group: 'About the person', label: 'Time zone' },
        { id: 'locale', group: 'About the person', label: 'Language' },
        { id: 'phone_number', group: 'Contact', label: 'Phone number' },
        { id: 'address_formatted', group: 'Address', label: 'Address' },
        { id: 'address_street', group: 'Address', label: 'Street' },
        { id: 'address_locality', group: 'Address', label: 'City' },
        { id: 'address_region', group: 'Address', label: 'Region' },
        { id: 'address_postal_code', group: 'Address', label: 'Postal code' },
        { id: 'address_country', group: 'Address', label: 'Country' },
      ],
    },
  ],
};
