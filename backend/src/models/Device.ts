import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * One row per physical install that can receive Expo remote pushes.
 * The same Expo push token upserts so re-login refreshes lastSeenAt / userId.
 */
const deviceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expoPushToken: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      required: true,
    },
    deviceName: {
      type: String,
      trim: true,
      default: "",
    },
    lastSeenAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
  },
);

// Unique sparse: one Mongo doc per push token; empty values ignored by sparse.
deviceSchema.index({ expoPushToken: 1 }, { unique: true, sparse: true });

export type DeviceDocument = InferSchemaType<typeof deviceSchema> & {
  _id: Schema.Types.ObjectId;
};

export const Device = model("Device", deviceSchema);
