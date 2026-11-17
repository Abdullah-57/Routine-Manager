import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useAuth } from "@/auth/AuthContext";
import { AppButton } from "@/components/ui/app-button";
import { AppTextField } from "@/components/ui/app-text-field";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import {
  createContact,
  deleteContact,
  listContacts,
  updateContact,
  type Contact,
} from "@/api/contacts";
import { colors, radius, shadows, spacing } from "@/theme";

function BackChevron() {
  if (process.env.EXPO_OS === "ios") {
    return (
      <SymbolView
        name="chevron.left"
        size={20}
        tintColor="#1D4ED8"
        weight="semibold"
      />
    );
  }
  return <Text style={styles.backFallback}>‹</Text>;
}

const AVATAR_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#059669",
  "#D97706",
  "#DC2626",
  "#0891B2",
  "#4F46E5",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index] || "#2563EB";
}

export function ContactsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "info";
    title: string;
    body: string;
  } | null>(null);

  // Modal / Form state for Add or Edit
  const [modalVisible, setModalVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await listContacts(token);
      setContacts(res.contacts);
    } catch (err) {
      setFeedback({
        tone: "error",
        title: "Could not load contacts",
        body: (err as Error).message || "Check your network connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filter contacts by search query
  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q)),
    );
  }, [contacts, searchQuery]);

  const openAddModal = () => {
    setEditingContact(null);
    setFormName("");
    setFormEmail("");
    setFormPhone("");
    setFormNotes("");
    setFormError(null);
    setModalVisible(true);
  };

  const openEditModal = (c: Contact) => {
    setEditingContact(c);
    setFormName(c.name);
    setFormEmail(c.email);
    setFormPhone(c.phone);
    setFormNotes(c.notes || "");
    setFormError(null);
    setModalVisible(true);
  };

  const handleSaveContact = async () => {
    if (!token) return;
    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }

    const trimmedEmail = formEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError("Please enter a valid email address (e.g. alex@example.com).");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (editingContact) {
        const res = await updateContact(token, editingContact.id, {
          name: trimmedName,
          email: trimmedEmail,
          phone: formPhone.trim(),
          notes: formNotes.trim(),
        });
        setContacts((prev) =>
          prev.map((c) => (c.id === editingContact.id ? res.contact : c)),
        );
        setFeedback({
          tone: "success",
          title: "Contact Updated",
          body: `Saved changes for ${res.contact.name}.`,
        });
      } else {
        const res = await createContact(token, {
          name: trimmedName,
          email: trimmedEmail,
          phone: formPhone.trim(),
          notes: formNotes.trim(),
        });
        setContacts((prev) => [...prev, res.contact].sort((a, b) => a.name.localeCompare(b.name)));
        setFeedback({
          tone: "success",
          title: "Contact Created",
          body: `${res.contact.name} is now available for voice assistant actions.`,
        });
      }
      setModalVisible(false);
    } catch (err) {
      setFormError((err as Error).message || "Could not save contact. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (c: Contact) => {
    Alert.alert(
      `Delete ${c.name}?`,
      "This contact will be permanently removed from your in-app address book.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void handleDeleteContact(c.id, c.name);
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleDeleteContact = async (id: string, name: string) => {
    if (!token) return;
    try {
      await deleteContact(token, id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setFeedback({
        tone: "info",
        title: "Contact Deleted",
        body: `${name} was removed from your contacts.`,
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        title: "Delete Failed",
        body: (err as Error).message || "Could not delete contact.",
      });
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.headerGlow} pointerEvents="none" />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md },
        ]}
      >
        {/* Top Header Row */}
        <View style={styles.titleRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <BackChevron />
          </Pressable>
          <Text style={styles.screenTitle}>Contacts</Text>
          <View style={styles.headerSpacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Contact"
            onPress={openAddModal}
            style={({ pressed }) => [
              styles.addHeaderButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.addHeaderButtonText}>+ Add</Text>
          </Pressable>
        </View>

        {/* Feature 2.4 Explanatory Card */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerIcon}>👥</Text>
          <View style={styles.infoBannerContent}>
            <Text style={styles.infoBannerTitle}>In-App Address Book</Text>
            <Text style={styles.infoBannerText}>
              When you say "Schedule a meeting with Alex", the assistant resolves Alex's email from here — zero external accounts required.
            </Text>
          </View>
        </View>

        {feedback ? (
          <FeedbackBanner
            tone={feedback.tone}
            title={feedback.title}
            body={feedback.body}
          />
        ) : null}

        {/* Search Bar */}
        <View style={styles.searchCard}>
          <AppTextField
            placeholder="Search contacts by name, email, or phone..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.searchInput}
          />
        </View>

        {loading ? (
          <ActivityIndicator color="#1D4ED8" style={styles.spinner} />
        ) : filteredContacts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>👤</Text>
            <Text style={styles.emptyTitle}>
              {searchQuery ? "No matching contacts" : "No contacts yet"}
            </Text>
            <Text style={styles.emptyText}>
              {searchQuery
                ? `No contacts found matching "${searchQuery}".`
                : "Add your friends, colleagues, or clients so the assistant can automatically send them video meeting invites."}
            </Text>
            {!searchQuery ? (
              <AppButton
                label="+ Add First Contact"
                onPress={openAddModal}
                style={styles.emptyAddButton}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.contactList}>
            {filteredContacts.map((c) => {
              const avatarColor = getAvatarColor(c.name);
              const initial = c.name.charAt(0).toUpperCase() || "C";

              return (
                <View key={c.id} style={styles.contactCard}>
                  <View style={styles.contactCardHeader}>
                    <View
                      style={[
                        styles.contactAvatar,
                        { backgroundColor: avatarColor },
                      ]}
                    >
                      <Text style={styles.contactAvatarText}>{initial}</Text>
                    </View>

                    <View style={styles.contactMeta}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      {c.email ? (
                        <Pressable
                          onPress={() => {
                            void Linking.openURL(`mailto:${c.email}`).catch(
                              () => {},
                            );
                          }}
                          style={styles.detailRow}
                        >
                          <Text style={styles.detailIcon}>✉️</Text>
                          <Text style={styles.contactEmail}>{c.email}</Text>
                        </Pressable>
                      ) : null}
                      {c.phone ? (
                        <Pressable
                          onPress={() => {
                            void Linking.openURL(`tel:${c.phone}`).catch(
                              () => {},
                            );
                          }}
                          style={styles.detailRow}
                        >
                          <Text style={styles.detailIcon}>📞</Text>
                          <Text style={styles.contactPhone}>{c.phone}</Text>
                        </Pressable>
                      ) : null}
                      {c.notes ? (
                        <Text style={styles.contactNotes} numberOfLines={2}>
                          {c.notes}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.actionButtons}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${c.name}`}
                        onPress={() => openEditModal(c)}
                        style={({ pressed }) => [
                          styles.iconButton,
                          pressed ? styles.pressed : null,
                        ]}
                      >
                        <Text style={styles.actionIconText}>✏️</Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${c.name}`}
                        onPress={() => confirmDelete(c)}
                        style={({ pressed }) => [
                          styles.iconButton,
                          styles.deleteIconButton,
                          pressed ? styles.pressed : null,
                        ]}
                      >
                        <Text style={styles.actionIconText}>🗑️</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Add / Edit Contact Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingContact ? "Edit Contact" : "Add New Contact"}
              </Text>
              <Pressable
                onPress={() => setModalVisible(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {formError ? (
              <FeedbackBanner tone="error" title="Validation" body={formError} />
            ) : null}

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Name *</Text>
              <AppTextField
                placeholder="e.g. Alex Johnson"
                value={formName}
                onChangeText={(t) => {
                  setFormName(t);
                  setFormError(null);
                }}
                autoCapitalize="words"
                style={styles.formInput}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Email Address</Text>
              <AppTextField
                placeholder="alex@example.com (for meeting invites)"
                value={formEmail}
                onChangeText={(t) => {
                  setFormEmail(t);
                  setFormError(null);
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                style={styles.formInput}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Phone Number · optional</Text>
              <AppTextField
                placeholder="+1 555-0199"
                value={formPhone}
                onChangeText={setFormPhone}
                keyboardType="phone-pad"
                style={styles.formInput}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Notes · optional</Text>
              <AppTextField
                placeholder="Designer, Project Lead, etc."
                value={formNotes}
                onChangeText={setFormNotes}
                multiline
                style={[styles.formInput, styles.notesInput]}
              />
            </View>

            <View style={styles.modalActions}>
              <AppButton
                label={editingContact ? "Save Changes" : "Create Contact"}
                loading={saving}
                onPress={() => {
                  void handleSaveContact();
                }}
                style={styles.saveButton}
              />
              <AppButton
                label="Cancel"
                variant="ghost"
                disabled={saving}
                onPress={() => setModalVisible(false)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  headerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    experimental_backgroundImage: `
      linear-gradient(180deg, rgba(147, 197, 253, 0.55) 0%, rgba(59, 130, 246, 0.18) 55%, rgba(255, 255, 255, 0) 100%)
    `,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  backFallback: {
    fontSize: 24,
    lineHeight: 26,
    color: "#1D4ED8",
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: "#0F172A",
  },
  headerSpacer: {
    flex: 1,
  },
  addHeaderButton: {
    backgroundColor: "#1D4ED8",
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
  },
  addHeaderButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + 2,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.25)",
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  infoBannerIcon: {
    fontSize: 22,
  },
  infoBannerContent: {
    flex: 1,
    gap: 2,
  },
  infoBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1E3A8A",
  },
  infoBannerText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#3B82F6",
  },
  searchCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.18)",
    boxShadow: shadows.subtle,
  },
  searchInput: {
    color: "#0F172A",
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: spacing.sm + 2,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: "rgba(37, 99, 235, 0.04)",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.15)",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1E3A8A",
  },
  emptyText: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 280,
  },
  emptyAddButton: {
    marginTop: spacing.sm,
    backgroundColor: "#1D4ED8",
  },
  contactList: {
    gap: spacing.sm,
  },
  contactCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.16)",
    padding: spacing.md,
    boxShadow: shadows.subtle,
  },
  contactCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md - 2,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  contactMeta: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  detailIcon: {
    fontSize: 11,
  },
  contactEmail: {
    fontSize: 13,
    color: "#2563EB",
    fontWeight: "500",
  },
  contactPhone: {
    fontSize: 13,
    color: "#059669",
    fontWeight: "500",
  },
  contactNotes: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIconButton: {
    backgroundColor: "rgba(220, 38, 38, 0.08)",
  },
  actionIconText: {
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    boxShadow: shadows.raised,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(100, 116, 139, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
  formGroup: {
    gap: spacing.xs,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563EB",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  formInput: {
    color: "#0F172A",
    backgroundColor: "#F8FAFC",
    borderColor: "rgba(37, 99, 235, 0.18)",
  },
  notesInput: {
    minHeight: 70,
  },
  modalActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  saveButton: {
    backgroundColor: "#1D4ED8",
  },
  pressed: {
    opacity: 0.85,
  },
});
