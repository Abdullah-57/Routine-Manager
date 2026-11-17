import { Contact } from "../models/Contact";
import { getValidGoogleAccessToken } from "./googleAuth";

export interface ContactMatch {
  name: string;
  email: string;
  phone?: string;
  source: "google" | "local";
}

export interface FindContactResult {
  found: boolean;
  ambiguous?: boolean;
  contact?: ContactMatch;
  matches: ContactMatch[];
  message?: string;
}

export async function findContact(
  userId: string,
  query: string,
): Promise<FindContactResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      found: false,
      matches: [],
      message: "Please specify a name or email to look up.",
    };
  }

  // If query is already an email address, resolve immediately
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    const directContact: ContactMatch = {
      name: trimmed.split("@")[0],
      email: trimmed.toLowerCase(),
      source: "local",
    };
    return {
      found: true,
      contact: directContact,
      matches: [directContact],
    };
  }

  const matches: ContactMatch[] = [];

  // 1. Search in-app MongoDB Contacts collection
  try {
    const localContacts = await Contact.find({
      userId,
      $or: [
        { name: { $regex: trimmed, $options: "i" } },
        { email: { $regex: trimmed, $options: "i" } },
      ],
    }).limit(5);

    for (const c of localContacts) {
      if (c.email || c.phone) {
        matches.push({
          name: c.name,
          email: c.email || "",
          phone: c.phone || "",
          source: "local",
        });
      }
    }
  } catch (err) {
    console.warn("[Contacts] Local contact search error:", err);
  }

  // 2. Search Google People API if connected
  try {
    const google = await getValidGoogleAccessToken(userId);
    if (google?.accessToken) {
      const url = `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(
        trimmed,
      )}&readMask=names,emailAddresses,phoneNumbers`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${google.accessToken}`,
        },
      });

      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            person?: {
              names?: Array<{ displayName?: string }>;
              emailAddresses?: Array<{ value?: string }>;
              phoneNumbers?: Array<{ value?: string }>;
            };
          }>;
        };

        if (Array.isArray(data.results)) {
          for (const item of data.results) {
            const person = item.person;
            const name = person?.names?.[0]?.displayName || trimmed;
            const email = person?.emailAddresses?.[0]?.value || "";
            const phone = person?.phoneNumbers?.[0]?.value || "";

            if (email || phone) {
              // Deduplicate if already present
              const exists = matches.some(
                (m) =>
                  (email && m.email.toLowerCase() === email.toLowerCase()) ||
                  (phone && m.phone === phone),
              );
              if (!exists) {
                matches.push({
                  name,
                  email,
                  phone,
                  source: "google",
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Contacts] Google People API search error:", err);
  }

  if (matches.length === 0) {
    return {
      found: false,
      matches: [],
      message: `No contact found for "${trimmed}". Would you like to provide their email address?`,
    };
  }

  if (matches.length === 1) {
    return {
      found: true,
      contact: matches[0],
      matches,
      message: `Found contact: ${matches[0].name} (${matches[0].email || matches[0].phone})`,
    };
  }

  // Ambiguous: multiple matches found
  const namesAndEmails = matches
    .map((m) => `${m.name} (${m.email || m.phone})`)
    .join(" or ");
  return {
    found: true,
    ambiguous: true,
    matches,
    message: `Found multiple contacts matching "${trimmed}": ${namesAndEmails}. Which one would you like?`,
  };
}

export async function createLocalContact(
  userId: string,
  data: { name: string; email?: string; phone?: string; notes?: string },
) {
  return Contact.create({
    userId,
    name: data.name.trim(),
    email: data.email?.trim() || "",
    phone: data.phone?.trim() || "",
    notes: data.notes?.trim() || "",
  });
}

export async function listLocalContacts(userId: string) {
  return Contact.find({ userId }).sort({ name: 1 });
}
