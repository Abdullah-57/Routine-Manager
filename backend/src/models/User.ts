import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      trim: true,
      default: "",
    },
    timezone: {
      type: String,
      trim: true,
      default: "UTC",
    },
    defaultLeadTimes: {
      simple: { type: [Number], default: [] },
      meeting: { type: [Number], default: [60, 15] },
      call: { type: [Number], default: [15] },
      custom: { type: [Number], default: [] },
    },
  },
  {
    timestamps: true,
  },
);

export type DefaultLeadTimes = {
  simple: number[];
  meeting: number[];
  call: number[];
  custom: number[];
};

export type UserDocument = InferSchemaType<typeof userSchema> & {
  _id: Schema.Types.ObjectId;
};

export const User = model("User", userSchema);
