import { Schema, model, type InferSchemaType, Types } from "mongoose";

export type IntegrationProvider = "google";

const integrationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["google"],
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
      default: "",
    },
    picture: {
      type: String,
      default: "",
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      default: "",
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    scopes: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["connected", "revoked", "expired"],
      default: "connected",
    },
  },
  {
    timestamps: true,
  },
);

// Ensure a user has at most one record per provider
integrationSchema.index({ userId: 1, provider: 1 }, { unique: true });

export type IntegrationDocument = InferSchemaType<typeof integrationSchema> & {
  _id: Types.ObjectId;
};

export const Integration = model("Integration", integrationSchema);
