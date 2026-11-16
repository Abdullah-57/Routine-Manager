import { Schema, model, type InferSchemaType, Types } from "mongoose";

const contactSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

contactSchema.index({ userId: 1, name: 1 });

export type ContactDocument = InferSchemaType<typeof contactSchema> & {
  _id: Types.ObjectId;
};

export const Contact = model("Contact", contactSchema);
