import { Schema, model, type InferSchemaType, Types } from "mongoose";

const toolCallSchema = new Schema(
  {
    name: { type: String, required: true },
    arguments: { type: Schema.Types.Mixed },
    result: { type: Schema.Types.Mixed },
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
    inputType: {
      type: String,
      enum: ["text", "audio"],
      default: "text",
    },
    rawTranscript: {
      type: String,
      required: true,
    },
    model: {
      type: String,
      required: true,
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
    timestamps: { createdAt: true, updatedAt: false },
  },
);

export type AiSessionDocument = InferSchemaType<typeof aiSessionSchema> & {
  _id: Types.ObjectId;
};

export const AiSession = model("AiSession", aiSessionSchema);
