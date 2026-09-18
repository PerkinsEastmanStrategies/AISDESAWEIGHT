"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { WEIGHT_LEVELS, WeightSlider, type WeightHoverDetails, type WeightLevel } from "@/components/weight-slider"
import { formatWeightShare } from "@/lib/format"
import {
  canonicalName,
  categoryKey,
  spaceKey,
  spaceSubcategoryKey,
} from "@/lib/normalize"
import {
  buildWeightTree,
  type WeightResolver,
  type WeightTreeCategory,
  type WeightTreeFocus,
  type WeightTreeSpace,
  type WeightTreeSubcategory,
} from "@/lib/weights"
import type { WeightFile, WeightOverrides } from "@/lib/types"

function matchesQuery(query: string, ...parts: Array<string | undefined>) {
  if (!query) return true
  return parts.some((part) => part?.toLowerCase().includes(query))
}

function subcategoryMatches(sub: WeightTreeSubcategory, query: string, category: string) {
  if (matchesQuery(query, sub.name, category)) return true
  return sub.questions.some((question) =>
    matchesQuery(query, question.questionId, question.question),
  )
}

function categoryMatches(category: WeightTreeCategory, query: string) {
  if (matchesQuery(query, category.name)) return true
  return category.subcategories.some((sub) => subcategoryMatches(sub, query, category.name))
}

function spaceMatches(space: WeightTreeSpace, query: string) {
  if (matchesQuery(query, space.name)) return true
  return space.categories.some((category) => categoryMatches(category, query))
}

function focusMatches(focus: WeightTreeFocus, query: string) {
  if (matchesQuery(query, focus.name)) return true
  return focus.spaces.some((space) => spaceMatches(space, query))
}

function ExpandableWeight({
  label,
  detail,
  value,
  defaultValue,
  siblingTotal,
  onChange,
  hasChildren,
  renderChildren,
  level,
  hoverDetails,
}: {
  label: string
  detail?: string
  value: number
  defaultValue: number
  siblingTotal?: number
  onChange: (value: number) => void
  hasChildren: boolean
  renderChildren?: () => ReactNode
  level: WeightLevel
  hoverDetails?: WeightHoverDetails
}) {
  const [open, setOpen] = useState(false)
  const expanded = hasChildren && open
  const tone = WEIGHT_LEVELS[level]

  return (
    <div>
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={expanded}
            className="mt-3.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="mt-3.5 w-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <WeightSlider
            label={label}
            detail={detail}
            value={value}
            defaultValue={defaultValue}
            siblingTotal={siblingTotal}
            onChange={onChange}
            level={level}
            hoverDetails={hoverDetails}
          />
        </div>
      </div>
      {expanded && renderChildren && (
        <div className={`ml-3 mt-1 space-y-1 border-l-2 pl-2 ${tone.border}`}>{renderChildren()}</div>
      )}
    </div>
  )
}

export function WeightEditor({
  weights,
  overrides,
  resolver,
  onChange,
}: {
  weights: WeightFile
  overrides: WeightOverrides
  resolver: WeightResolver
  onChange: (next: WeightOverrides) => void
}) {
  const [query, setQuery] = useState("")
  const tree = useMemo(() => buildWeightTree(weights), [weights])
  const filteredQuery = query.trim().toLowerCase()
  const visible = filteredQuery ? tree.filter((focus) => focusMatches(focus, filteredQuery)) : tree
  const focusTotal = tree.reduce((sum, focus) => sum + resolver.focus(focus.name), 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search space, category, or question"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(Object.keys(WEIGHT_LEVELS) as WeightLevel[]).map((level) => (
          <span
            key={level}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200"
          >
            <span className={`h-2 w-2 rounded-full ${WEIGHT_LEVELS[level].chip}`} />
            {WEIGHT_LEVELS[level].name}
          </span>
        ))}
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {visible.map((focus) => (
          <ExpandableWeight
            key={focus.name}
            level="focus"
            label={focus.name}
            value={resolver.focus(focus.name)}
            defaultValue={resolver.defaults.focus.get(canonicalName(focus.name)) ?? 6}
            siblingTotal={focusTotal}
            hasChildren={focus.spaces.length > 0}
            onChange={(value) =>
              onChange({
                ...overrides,
                focus: { ...overrides.focus, [canonicalName(focus.name)]: value },
              })
            }
            renderChildren={() => {
              const spaces = filteredQuery
                ? focus.spaces.filter((space) => spaceMatches(space, filteredQuery))
                : focus.spaces
              const spaceTotal = focus.spaces.reduce(
                (sum, space) => sum + resolver.space(focus.name, space.name),
                0,
              )

              return spaces.map((space) => (
                <ExpandableWeight
                  key={space.name}
                  level="space"
                  label={space.name}
                  value={resolver.space(focus.name, space.name)}
                  defaultValue={resolver.defaults.space.get(spaceKey(focus.name, space.name)) ?? 6}
                  siblingTotal={spaceTotal}
                  hasChildren={space.categories.length > 0}
                  onChange={(value) =>
                    onChange({
                      ...overrides,
                      space: {
                        ...overrides.space,
                        [spaceKey(focus.name, space.name)]: value,
                      },
                    })
                  }
                  renderChildren={() => {
                    const categories = filteredQuery
                      ? space.categories.filter((category) =>
                          categoryMatches(category, filteredQuery),
                        )
                      : space.categories
                    const categoryTotal = space.categories.reduce(
                      (sum, category) =>
                        sum + resolver.category(category.name, focus.name, space.name),
                      0,
                    )

                    return categories.map((category) => (
                      <ExpandableWeight
                        key={category.name}
                        level="category"
                        label={category.name}
                        value={resolver.category(category.name, focus.name, space.name)}
                        defaultValue={
                          resolver.defaults.category.get(
                            categoryKey(focus.name, space.name, category.name),
                          ) ?? 6
                        }
                        siblingTotal={categoryTotal}
                        hasChildren={category.subcategories.length > 0}
                        onChange={(value) =>
                          onChange({
                            ...overrides,
                            category: {
                              ...overrides.category,
                              [categoryKey(focus.name, space.name, category.name)]: value,
                            },
                          })
                        }
                        renderChildren={() => {
                          const subcategories = filteredQuery
                            ? category.subcategories.filter((sub) =>
                                subcategoryMatches(sub, filteredQuery, category.name),
                              )
                            : category.subcategories
                          const subcategoryTotal = category.subcategories.reduce(
                            (sum, sub) =>
                              sum +
                              resolver.subcategory(
                                category.name,
                                sub.name,
                                focus.name,
                                space.name,
                              ),
                            0,
                          )

                          return subcategories.map((sub) => (
                            <ExpandableWeight
                              key={sub.name}
                              level="subcategory"
                              label={sub.name}
                              value={resolver.subcategory(
                                category.name,
                                sub.name,
                                focus.name,
                                space.name,
                              )}
                              defaultValue={
                                resolver.defaults.subcategory.get(
                                  spaceSubcategoryKey(
                                    focus.name,
                                    space.name,
                                    category.name,
                                    sub.name,
                                  ),
                                ) ?? 6
                              }
                              siblingTotal={subcategoryTotal}
                              hasChildren={sub.questions.length > 0}
                              onChange={(value) =>
                                onChange({
                                  ...overrides,
                                  subcategory: {
                                    ...overrides.subcategory,
                                    [spaceSubcategoryKey(
                                      focus.name,
                                      space.name,
                                      category.name,
                                      sub.name,
                                    )]: value,
                                  },
                                })
                              }
                              renderChildren={() => {
                                const questions = filteredQuery
                                  ? sub.questions.filter((question) =>
                                      matchesQuery(
                                        filteredQuery,
                                        question.questionId,
                                        question.question,
                                        sub.name,
                                      ),
                                    )
                                  : sub.questions
                                const questionTotal = sub.questions.reduce(
                                  (sum, question) =>
                                    sum +
                                    resolver.question(
                                      question.questionId,
                                      category.name,
                                      question.question,
                                    ),
                                  0,
                                )

                                return questions.map((question) => {
                                  const weight = resolver.question(
                                    question.questionId,
                                    category.name,
                                    question.question,
                                  )
                                  const defaultWeight =
                                    resolver.defaults.question.get(question.questionId) ?? 6
                                  return (
                                  <ExpandableWeight
                                    key={question.questionId}
                                    level="question"
                                    label={question.questionId}
                                    detail={question.question}
                                    value={weight}
                                    defaultValue={defaultWeight}
                                    siblingTotal={questionTotal}
                                    hasChildren={false}
                                    hoverDetails={{
                                      questionId: question.questionId,
                                      question: question.question,
                                      path: [
                                        focus.name,
                                        space.name,
                                        category.name,
                                        sub.name,
                                      ],
                                      weight,
                                      share: formatWeightShare(weight, questionTotal),
                                      defaultWeight,
                                    }}
                                    onChange={(value) =>
                                      onChange({
                                        ...overrides,
                                        question: {
                                          ...overrides.question,
                                          [question.questionId]: value,
                                        },
                                      })
                                    }
                                  />
                                  )
                                })
                              }}
                            />
                          ))
                        }}
                      />
                    ))
                  }}
                />
              ))
            }}
          />
        ))}
      </div>
    </div>
  )
}
