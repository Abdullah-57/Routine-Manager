import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { Contact } from "../models/Contact";
import { createLocalContact, findContact, listLocalContacts } from "../services/contacts";

export const contactsRouter = Router();

// List contacts
contactsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const contacts = await listLocalContacts(userId);
    return res.status(200).json({ ok: true, contacts });
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

// Create new contact
contactsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, email, phone, notes } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Contact name is required" });
    }

    const contact = await createLocalContact(userId, { name, email, phone, notes });
    return res.status(201).json({ ok: true, contact });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Delete contact
contactsRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    await Contact.deleteOne({ _id: id, userId });
    return res.status(200).json({ ok: true, message: "Contact deleted" });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});
