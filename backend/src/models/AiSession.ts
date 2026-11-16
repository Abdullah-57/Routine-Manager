import { Schema, model, type InferSchemaType, Types } from "mongoose";

const toolCallSchema = new Schema(
  {
    name: { type: String, required: true },
    arguments: { type: Schema.Types.Mixed },
    result: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const turnSchema = new Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    toolCalls: { type: [toolCallSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const aiSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },
    inputType: {
      type: String,
      enum: ["text", "audio"],
      default: "text",
    },
    turns: {
      type: [turnSchema],
      default: [],
    },
    rawTranscript: {
      type: String,
      default: "",
    },
    model: {
      type: String,
      default: "gpt-4o-mini",
    },
    toolCalls: {
      type: [toolCallSchema],
      default: [],
    },
    assistantMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

export type AiSessionDocument = InferSchemaType<typeof aiSessionSchema> & {
  _id: Types.ObjectId;
};

export const AiSession = model("AiSession", aiSessionSchema);
