import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { Contact } from "../models/Contact";
import { createLocalContact, findContact } from "../services/contacts";

export const contactsRouter = Router();

function publicContact(c: any) {
  return {
    id: c._id.toString(),
    userId: c.userId.toString(),
    name: c.name,
    email: c.email ?? "",
    phone: c.phone ?? "",
    notes: c.notes ?? "",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// List contacts (supports optional ?q= filter)
contactsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter: any = { userId };
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }
    const contacts = await Contact.find(filter).sort({ name: 1 });
    return res.status(200).json({ ok: true, contacts: contacts.map(publicContact) });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Search contacts across local and Google
contactsRouter.get("/search", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const result = await findContact(userId, query);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Get single contact by id
contactsRouter.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const contact = await Contact.findOne({ _id: id, userId });
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }
    return res.status(200).json({ ok: true, contact: publicContact(contact) });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Create new contact
contactsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, email, phone, notes } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Contact name is required" });
    }

    const contact = await createLocalContact(userId, { name, email, phone, notes });
    return res.status(201).json({ ok: true, contact: publicContact(contact) });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Update contact
contactsRouter.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, email, phone, notes } = req.body;
    const contact = await Contact.findOne({ _id: id, userId });
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Contact name cannot be empty" });
      contact.name = name.trim();
    }
    if (email !== undefined) contact.email = email.trim().toLowerCase();
    if (phone !== undefined) contact.phone = phone.trim();
    if (notes !== undefined) contact.notes = notes.trim();
    await contact.save();
    return res.status(200).json({ ok: true, contact: publicContact(contact) });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Delete contact
contactsRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const result = await Contact.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }
    return res.status(200).json({ ok: true, message: "Contact deleted" });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});
