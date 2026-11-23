import { Schema } from "effect"

const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const required = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const Identifier = Schema.String.check(Schema.isMaxLength(40), Schema.isPattern(/^(?!(?:true|false)$)[A-Za-z_][A-Za-z0-9_]*$/)).annotate({
  description: "Unique identifier: letters, digits and underscore, starting with a letter or underscore; true and false are reserved."
})

const options = <S extends Schema.Top>(option: S) => Schema.Array(option).check(Schema.isMinLength(2), Schema.isMaxLength(6))

const tolerance = 2

const aim = (max: number, description: string | undefined) => ({
  description: `${description === undefined ? "" : `${description} `}Aim for ${max} characters or fewer.`
})

const shown = (max: number, description?: string) => text(max * tolerance).annotate(aim(max, description))

const shownRequired = (max: number, description?: string) => required(max * tolerance).annotate(aim(max, description))

const commonFields = {
  id: Identifier,
  label: shownRequired(60, "Label shown to the user, in the user's language."),
  description: Schema.optionalKey(
    shown(120, "What this question asks or what the value is used for, independent of your recommendation. Shown under the label.")
  ),
  reason: Schema.optionalKey(
    shown(
      60,
      "One sentence on why you recommend the default for this situation, citing what you found. Shown with the recommended value. Only allowed together with default."
    )
  ),
  reasonDetails: Schema.optionalKey(
    shown(300, "More on why you recommend the default, in full sentences. Can be hidden by the user. Only allowed together with default.")
  ),
  when: Schema.optionalKey(
    Schema.Struct({
      field: Identifier.annotate({
        description: "The id of an earlier choice or searchChoice field, single or multiple."
      }),
      anyOf: Schema.Array(required(60)).check(Schema.isMinLength(1)).annotate({
        description: "Option values of that field. The field is shown while one of them is selected."
      })
    }).annotate({
      description:
        "Show this field only while an earlier choice or searchChoice field has one of anyOf selected. For a follow-up question, put it as an ordinary field right after the question it depends on and give it when. While hidden, the field is left out of the answer, and so are fields whose when refers to it."
    })
  )
}

const ChoiceOption = Schema.Struct({
  value: required(60),
  label: shownRequired(60),
  description: Schema.optionalKey(shown(60, "One sentence on what this option is or what happens if chosen. Always shown.")),
  details: Schema.optionalKey(
    shown(300, "More on this option in full sentences, such as its trade-offs or implications. Can be hidden by the user.")
  )
})

const Computed = Schema.Struct({
  id: Identifier,
  label: shownRequired(60),
  expression: required(300).annotate({
    description:
      "Arithmetic over field ids and earlier computed ids. Operators + - * / % < <= > >= == != && || ! ?: and min max abs floor ceil round."
  }),
  prefix: Schema.optionalKey(text(8)),
  suffix: Schema.optionalKey(text(8)),
  decimals: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }))),
  primary: Schema.optionalKey(Schema.Boolean)
})

const TextField = Schema.Struct({
  type: Schema.Literal("text"),
  ...commonFields,
  default: Schema.optionalKey(text(500)),
  placeholder: Schema.optionalKey(shown(80)),
  multiline: Schema.optionalKey(Schema.Boolean)
})

const numericFields = {
  min: Schema.Finite,
  max: Schema.Finite,
  step: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  prefix: Schema.optionalKey(text(8)),
  suffix: Schema.optionalKey(text(8))
}

const NumberField = Schema.Struct({
  type: Schema.Literal("number"),
  ...commonFields,
  default: Schema.optionalKey(Schema.Finite),
  ...numericFields
})

const NumberRangeField = Schema.Struct({
  type: Schema.Literal("numberRange"),
  ...commonFields,
  default: Schema.optionalKey(
    Schema.Array(Schema.Finite).check(Schema.isMinLength(2), Schema.isMaxLength(2)).annotate({
      description: "The recommended lower and upper bounds, as [lower, upper], within min and max."
    })
  ),
  ...numericFields
}).annotate({
  description: "The user answers a span of numbers with a lower and an upper bound. The answer is [lower, upper]."
})

const IsoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).annotate({ description: "A date as YYYY-MM-DD." })

const IsoTime = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).annotate({
  description: "A time of day as 24-hour HH:MM."
})

const DateField = Schema.Struct({
  type: Schema.Literal("date"),
  ...commonFields,
  default: Schema.optionalKey(IsoDate),
  min: Schema.optionalKey(IsoDate),
  max: Schema.optionalKey(IsoDate)
}).annotate({ description: "A calendar date. The answer is a YYYY-MM-DD string." })

const TimeField = Schema.Struct({
  type: Schema.Literal("time"),
  ...commonFields,
  default: Schema.optionalKey(IsoTime),
  min: Schema.optionalKey(IsoTime),
  max: Schema.optionalKey(IsoTime),
  step: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 720 })).annotate({
      description: "Minutes between allowed times, counted from min, or from 00:00 without min."
    })
  )
}).annotate({ description: "A time of day. The answer is a 24-hour HH:MM string." })

const pickFields = {
  ...commonFields,
  default: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  multiple: Schema.optionalKey(Schema.Boolean)
}

const ChoiceField = Schema.Struct({ type: Schema.Literal("choice"), ...pickFields, options: options(ChoiceOption) })

const SearchChoiceField = Schema.Struct({
  type: Schema.Literal("searchChoice"),
  ...pickFields,
  options: Schema.Array(ChoiceOption).check(Schema.isMinLength(7), Schema.isMaxLength(100))
}).annotate({
  description:
    "The user finds options by name among 7 to 100 candidates, typing to narrow the list, and picks one, or several with multiple. Use choice to compare 2 to 6 options with their explanations, searchChoice to find candidates by name among 7 or more, and treeChoice when the candidates form a hierarchy."
})

const TextListField = Schema.Struct({
  type: Schema.Literal("textList"),
  ...commonFields,
  default: Schema.optionalKey(Schema.Array(required(200)).check(Schema.isMaxLength(20))),
  placeholder: Schema.optionalKey(shown(80))
}).annotate({
  description:
    "The user writes any number of short free-form values, such as paths, tags or domains. The answer is an array of up to 20 distinct strings."
})

const treeNodeFields = {
  value: required(200),
  label: shownRequired(60),
  description: Schema.optionalKey(shown(60, "One sentence on what this item is. Always shown."))
}

const treeChildren = <S extends Schema.Top>(node: S) => ({
  children: Schema.optionalKey(Schema.Array(node).check(Schema.isMinLength(1)))
})

const TreeLeaf = Schema.Struct(treeNodeFields)
const TreeNode3 = Schema.Struct({ ...treeNodeFields, ...treeChildren(TreeLeaf) })
const TreeNode2 = Schema.Struct({ ...treeNodeFields, ...treeChildren(TreeNode3) })
const TreeNode = Schema.Struct({ ...treeNodeFields, ...treeChildren(TreeNode2) })

const TreeChoiceField = Schema.Struct({
  type: Schema.Literal("treeChoice"),
  ...pickFields,
  nodes: Schema.Array(TreeNode).check(Schema.isMinLength(1)).annotate({
    description:
      "Items in a hierarchy, up to 4 levels and 100 items in all, such as folders and files. Every value is unique in the whole tree. Any item, branch or leaf, can be chosen."
  })
}).annotate({
  description:
    "The user picks from a hierarchy, such as a folder, a file or a module. With multiple, checking a branch checks everything in it, and the answer lists the outermost fully checked items."
})

const RankingField = Schema.Struct({
  type: Schema.Literal("ranking"),
  ...commonFields,
  default: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description: "The option values you recommend ranking, in your recommended order, first to last. Within min and max items."
    })
  ),
  min: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })).annotate({
      description: "The fewest options the user must rank. Defaults to 1."
    })
  ),
  max: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })).annotate({
      description: "The most options the user can rank, such as 3 for a top three. Defaults to every option."
    })
  ),
  options: Schema.Array(ChoiceOption).check(Schema.isMinLength(2), Schema.isMaxLength(8))
}).annotate({
  description:
    "The user moves options from the candidates into a ranked list, in order, such as priorities. The answer lists the ranked option values from first to last; unranked options are left out."
})

const Field = Schema.Union([
  TextField,
  TextListField,
  NumberField,
  NumberRangeField,
  DateField,
  TimeField,
  ChoiceField,
  SearchChoiceField,
  TreeChoiceField,
  RankingField
])

export const FormSpec = Schema.Struct({
  title: shownRequired(80),
  description: Schema.optionalKey(shown(300)),
  fields: Schema.Array(Field).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  computed: Schema.optionalKey(Schema.Array(Computed).check(Schema.isMaxLength(8)))
})

export type TextField = typeof TextField.Type
export type TextListField = typeof TextListField.Type
export type NumberField = typeof NumberField.Type
export type NumberRangeField = typeof NumberRangeField.Type
export type DateField = typeof DateField.Type
export type TimeField = typeof TimeField.Type
export type ChoiceField = typeof ChoiceField.Type
export type SearchChoiceField = typeof SearchChoiceField.Type
export type TreeChoiceField = typeof TreeChoiceField.Type
export interface TreeNode {
  readonly value: string
  readonly label: string
  readonly description?: string
  readonly children?: ReadonlyArray<TreeNode>
}
export type RankingField = typeof RankingField.Type
export type Field = typeof Field.Type
export type Computed = typeof Computed.Type
export type FormSpec = typeof FormSpec.Type
