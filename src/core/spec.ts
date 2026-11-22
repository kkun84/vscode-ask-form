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
  advanced: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: "Fold this field into the collapsed Details section."
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

const RangeField = Schema.Struct({
  type: Schema.Literal("range"),
  ...commonFields,
  default: Schema.optionalKey(
    Schema.Tuple([Schema.Finite, Schema.Finite]).annotate({
      description: "The recommended lower and upper bounds, as [lower, upper], within min and max."
    })
  ),
  ...numericFields
}).annotate({
  description: "The user answers a span of numbers with a lower and an upper bound. The answer is [lower, upper]."
})

const choiceFields = {
  type: Schema.Literal("choice"),
  ...commonFields,
  default: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  multiple: Schema.optionalKey(Schema.Boolean)
}

const NestedChoiceField = Schema.Struct({ ...choiceFields, options: options(ChoiceOption) })

const NestedField = Schema.Union([TextField, NumberField, NestedChoiceField, RangeField])

const BranchOption = Schema.Struct({
  ...ChoiceOption.fields,
  fields: Schema.optionalKey(
    Schema.Array(NestedField).check(Schema.isMinLength(1), Schema.isMaxLength(10)).annotate({
      description:
        "Follow-up fields asked only while this option is selected. Only for a single-select choice at the top level; the answer contains only the chosen option's fields."
    })
  )
})

const ChoiceField = Schema.Struct({ ...choiceFields, options: options(BranchOption) })

const Field = Schema.Union([TextField, NumberField, ChoiceField, RangeField])

export const FormSpec = Schema.Struct({
  title: shownRequired(80),
  description: Schema.optionalKey(shown(300)),
  fields: Schema.Array(Field).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  computed: Schema.optionalKey(Schema.Array(Computed).check(Schema.isMaxLength(8)))
})

export type TextField = typeof TextField.Type
export type NumberField = typeof NumberField.Type
export type RangeField = typeof RangeField.Type
export type ChoiceField = typeof ChoiceField.Type
export type Field = typeof Field.Type
export type Computed = typeof Computed.Type
export type FormSpec = typeof FormSpec.Type
