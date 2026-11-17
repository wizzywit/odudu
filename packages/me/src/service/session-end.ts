// How many sessions one request ends. A person with more is told to ask again,
// so the work of a request stays bounded whatever a subject holds.
export const SESSION_END_LIMIT = 100;
