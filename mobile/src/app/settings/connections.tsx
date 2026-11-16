import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { AppButton } from "@/components/ui/app-button";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import {
  getGoogleStatus,
  type GoogleIntegration,
  type GoogleStatusResponse,
} from "@/api/integrations";
import {
  devConnectMockGoogle,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from "@/services/googleAuth";
import { colors, radius, shadows, spacing } from "@/theme";

export default function ConnectedAccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const searchParams = useLocalSearchParams<{
    status?: string;
    message?: string;
    email?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatusResponse | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "info";
    title: string;
    body: string;
  } | null>(null);

  const loadStatus = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await getGoogleStatus(token);
      setGoogleStatus(res);
    } catch (err) {
      setFeedback({
        tone: "error",
        title: "Connection Status Error",
        body: (err as Error).message || "Could not retrieve connected account status.",
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Handle deep link query parameters returned from OAuth flow
  useEffect(() => {
    if (searchParams.status === "success") {
      setFeedback({
        tone: "success",
        title: "Google Account Connected",
        body: searchParams.email
          ? `Connected as ${searchParams.email}. Voice assistant actions are now enabled.`
          : "Your Google account has been linked successfully.",
      });
      void loadStatus();
    } else if (searchParams.status === "error") {
      setFeedback({
        tone: "error",
        title: "Connection Failed",
        body: searchParams.message || "Failed to complete Google authorization.",
      });
    }
  }, [searchParams.status, searchParams.message, searchParams.email, loadStatus]);

  const handleConnect = async () => {
    if (!token) return;
    setConnecting(true);
    setFeedback(null);

    try {
      // Check if server has Google OAuth credentials configured
      if (googleStatus && !googleStatus.isConfigured) {
        Alert.alert(
          "Google OAuth Setup Required",
          "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured on the backend server yet.\n\nWould you like to connect a test Google account to verify Feature 2.1?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Connect Test Account",
              onPress: async () => {
                setConnecting(true);
                const devRes = await devConnectMockGoogle(
                  token,
                  user?.email || "personal.alex@gmail.com",
                );
                if (devRes.success) {
                  setFeedback({
                    tone: "success",
                    title: "Test Account Linked",
                    body: "Simulated personal Google account connected. Voice assistant action tools can now be tested.",
                  });
                  await loadStatus();
                } else {
                  setFeedback({
                    tone: "error",
                    title: "Test Connection Failed",
                    body: devRes.message || "Could not connect test account.",
                  });
                }
                setConnecting(false);
              },
            },
          ],
        );
        return;
      }

      const result = await linkGoogleAccount(token);
      if (result.success) {
        setFeedback({
          tone: "success",
          title: "Connected",
          body: result.message || "Google account linked successfully.",
        });
        await loadStatus();
      } else if (result.message && result.message !== "Sign-in cancelled by user.") {
        setFeedback({
          tone: "error",
          title: "Connection Failed",
          body: result.message,
        });
      }
    } catch (err) {
      setFeedback({
        tone: "error",
        title: "Error",
        body: (err as Error).message || "An unexpected error occurred during Google sign-in.",
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!token) return;
    Alert.alert(
      "Disconnect Google Account",
      "Are you sure you want to unlink your Google account? Assistant actions like contact lookup and emailing meeting invites will be disabled.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setDisconnecting(true);
            try {
              const res = await unlinkGoogleAccount(token);
              if (res.success) {
                setFeedback({
                  tone: "info",
                  title: "Account Disconnected",
                  body: "Your Google account has been unlinked from Routine Manager.",
                });
                await loadStatus();
              } else {
                setFeedback({
                  tone: "error",
                  title: "Disconnection Failed",
                  body: res.message,
                });
              }
            } catch (err) {
              setFeedback({
                tone: "error",
                title: "Error",
                body: (err as Error).message,
              });
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],
    );
  };

  const isConnected = Boolean(googleStatus?.connected && googleStatus.integration);
  const integration: GoogleIntegration | null = googleStatus?.integration || null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Navigation Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={12}
        >
          <Text style={styles.backButtonText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Connected Accounts</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={styles.sectionTitle}>Autonomous Action Providers</Text>
        <Text style={styles.sectionSubtitle}>
          Link your Google account to grant the assistant permission to look up contact emails and dispatch meeting invites autonomously.
        </Text>

        {feedback ? (
          <View style={styles.feedbackBanner}>
            <FeedbackBanner
              tone={feedback.tone}
              title={feedback.title}
              body={feedback.body}
            />
          </View>
        ) : null}

        {/* Google Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.providerInfo}>
              <View style={styles.googleIconCircle}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
              <View>
                <Text style={styles.providerName}>Google</Text>
                <Text style={styles.providerSub}>Gmail & Contacts Integration</Text>
              </View>
            </View>

            <View
              style={[
                styles.statusBadge,
                isConnected ? styles.statusBadgeConnected : styles.statusBadgeDisconnected,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  isConnected ? styles.statusDotGreen : styles.statusDotGray,
                ]}
              />
              <Text
                style={[
                  styles.statusBadgeText,
                  isConnected ? styles.statusBadgeTextGreen : styles.statusBadgeTextGray,
                ]}
              >
                {isConnected ? "Connected" : "Not Linked"}
              </Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={colors.seed} />
              <Text style={styles.loadingText}>Checking connection status...</Text>
            </View>
          ) : isConnected && integration ? (
            <View style={styles.connectedDetails}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Account Email</Text>
                <Text style={styles.infoValue}>{integration.email}</Text>
              </View>

              {integration.displayName ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Account Name</Text>
                  <Text style={styles.infoValue}>{integration.displayName}</Text>
                </View>
              ) : null}

              <View style={styles.divider} />

              <Text style={styles.scopesTitle}>Granted Permissions</Text>

              <View style={styles.scopeItem}>
                <Text style={styles.scopeIcon}>👥</Text>
                <View style={styles.scopeTextCol}>
                  <Text style={styles.scopeHeading}>Contacts Lookup (contacts.readonly)</Text>
                  <Text style={styles.scopeDescription}>
                    Resolves recipient names (e.g. "Alex") to their email addresses.
                  </Text>
                </View>
              </View>

              <View style={styles.scopeItem}>
                <Text style={styles.scopeIcon}>✉️</Text>
                <View style={styles.scopeTextCol}>
                  <Text style={styles.scopeHeading}>Email Dispatch (gmail.send)</Text>
                  <Text style={styles.scopeDescription}>
                    Dispatches meeting invites and schedule links directly from your address.
                  </Text>
                </View>
              </View>

              <View style={styles.scopeItem}>
                <Text style={styles.scopeIcon}>👤</Text>
                <View style={styles.scopeTextCol}>
                  <Text style={styles.scopeHeading}>Identity Profile (userinfo.email)</Text>
                  <Text style={styles.scopeDescription}>
                    Verifies and links your personal Google account.
                  </Text>
                </View>
              </View>

              <View style={styles.privacyCallout}>
                <Text style={styles.privacyShield}>🛡️</Text>
                <Text style={styles.privacyText}>
                  <Text style={styles.privacyBold}>Zero Google Calendar Scope:</Text> Routine Manager never requests access to your Google Calendar. All schedules live safely in your local calendar.
                </Text>
              </View>

              <View style={styles.actionRow}>
                <AppButton
                  label="Disconnect Google Account"
                  variant="danger"
                  loading={disconnecting}
                  onPress={handleDisconnect}
                />
              </View>
            </View>
          ) : (
            <View style={styles.disconnectedDetails}>
              <Text style={styles.disconnectedIntro}>
                Say things like: <Text style={styles.italic}>"Schedule a meeting with Alex at 5 PM"</Text>
              </Text>
              <Text style={styles.featureBenefit}>
                • Assistant finds Alex's email from your contacts{"\n"}
                • Automatically creates an encrypted video meeting link{"\n"}
                • Sends Alex an invite email directly with 1 voice command
              </Text>

              <View style={styles.privacyCallout}>
                <Text style={styles.privacyShield}>🔒</Text>
                <Text style={styles.privacyText}>
                  100% Free & Personal. Works with any standard @gmail.com. No business domain or credit card required.
                </Text>
              </View>

              <View style={styles.actionRow}>
                <AppButton
                  label="Connect Google Account"
                  variant="primary"
                  loading={connecting}
                  onPress={handleConnect}
                />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.systemBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  backButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.seed,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.label,
  },
  headerRightSpacer: {
    width: 48,
  },
  scrollContent: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.label,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.secondaryLabel,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  feedbackBanner: {
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.systemBackground,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    padding: spacing.md,
    boxShadow: shadows.subtle,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  providerInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  googleIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EA4335",
    alignItems: "center",
    justifyContent: "center",
  },
  googleIconText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  providerName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.label,
  },
  providerSub: {
    fontSize: 12,
    color: colors.secondaryLabel,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 6,
  },
  statusBadgeConnected: {
    backgroundColor: "#DCFCE7",
  },
  statusBadgeDisconnected: {
    backgroundColor: colors.fill,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotGreen: {
    backgroundColor: "#16A34A",
  },
  statusDotGray: {
    backgroundColor: colors.tertiaryLabel,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  statusBadgeTextGreen: {
    color: "#15803D",
  },
  statusBadgeTextGray: {
    color: colors.secondaryLabel,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    fontSize: 14,
    color: colors.secondaryLabel,
  },
  connectedDetails: {
    marginTop: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.secondaryLabel,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.label,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginVertical: spacing.md,
  },
  scopesTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.secondaryLabel,
    marginBottom: spacing.sm,
  },
  scopeItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  scopeIcon: {
    fontSize: 18,
    marginTop: 1,
  },
  scopeTextCol: {
    flex: 1,
  },
  scopeHeading: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.label,
    marginBottom: 2,
  },
  scopeDescription: {
    fontSize: 12,
    color: colors.secondaryLabel,
    lineHeight: 16,
  },
  privacyCallout: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  privacyShield: {
    fontSize: 16,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    color: "#166534",
    lineHeight: 18,
  },
  privacyBold: {
    fontWeight: "700",
  },
  disconnectedDetails: {
    marginTop: spacing.md,
  },
  disconnectedIntro: {
    fontSize: 14,
    color: colors.label,
    marginBottom: spacing.xs,
  },
  italic: {
    fontStyle: "italic",
    fontWeight: "600",
  },
  featureBenefit: {
    fontSize: 13,
    color: colors.secondaryLabel,
    lineHeight: 20,
    marginVertical: spacing.xs,
  },
  actionRow: {
    marginTop: spacing.sm,
  },
});
