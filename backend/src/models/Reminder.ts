import { Schema, model, type InferSchemaType, Types } from "mongoose";

const reminderSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
    },
    timezone: {
      type: String,
      trim: true,
      default: "UTC",
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled"],
      default: "scheduled",
    },
    source: {
      type: String,
      enum: ["ai", "manual"],
      default: "manual",
    },
    localNotificationId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

reminderSchema.index({ userId: 1, startAt: 1 });
reminderSchema.index({ userId: 1, status: 1 });

export type ReminderDocument = InferSchemaType<typeof reminderSchema> & {
  _id: Types.ObjectId;
};

export const Reminder = model("Reminder", reminderSchema);
