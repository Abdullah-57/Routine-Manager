import { apiFetch } from "@/api/client";

export interface Contact {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListContactsResponse {
  ok: boolean;
  contacts: Contact[];
}

export interface ContactDetailResponse {
  ok: boolean;
  contact: Contact;
}

export interface CreateContactInput {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface UpdateContactInput {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export function listContacts(token: string, query?: string) {
  const params = new URLSearchParams();
  if (query && query.trim()) {
    params.set("q", query.trim());
  }
  const qs = params.toString();

  return apiFetch<ListContactsResponse>(`/contacts${qs ? `?${qs}` : ""}`, {
    method: "GET",
    token,
  });
}

export function getContact(token: string, id: string) {
  return apiFetch<ContactDetailResponse>(`/contacts/${id}`, {
    method: "GET",
    token,
  });
}

export function createContact(token: string, input: CreateContactInput) {
  return apiFetch<ContactDetailResponse>("/contacts", {
    method: "POST",
    token,
    body: input,
  });
}

export function updateContact(
  token: string,
  id: string,
  input: UpdateContactInput,
) {
  return apiFetch<ContactDetailResponse>(`/contacts/${id}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteContact(token: string, id: string) {
  return apiFetch<{ ok: boolean; message: string }>(`/contacts/${id}`, {
    method: "DELETE",
    token,
  });
}
