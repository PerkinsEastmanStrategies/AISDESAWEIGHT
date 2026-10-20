import { commentTextParts } from "@/lib/qa-scoring-notes"

export function CommentText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
      {commentTextParts(text).map((part, index) =>
        part.type === "mention" ? (
          <span
            key={`${part.value}-${index}`}
            className="rounded-md bg-amber-100 px-1 py-0.5 font-semibold text-amber-900"
          >
            {part.value}
          </span>
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </span>
  )
}
