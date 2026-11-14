import { Schema } from "effect"

const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const required = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const Identifier = Schema.String.check(Schema.isMaxLength(40), Schema.isPattern(/^(?!(?:true|false)$)[A-Za-z_][A-Za-z0-9_]*$/)).annotate({
  description: "Unique identifier: letters, digits and underscore, starting with a letter or underscore; true and false are reserved."
})

const commonFields = {
  id: Identifier,
  label: required(60).annotate({ description: "Label shown to the user, in the user's language." }),
  reason: Schema.optionalKey(
    text(60).annotate({
      description:
        "For a choice, one sentence on why the default option is the best fit here, citing what you found. For other fields, one sentence on what the prefilled value means."
    })
  ),
  reasonDetails: Schema.optionalKey(
    text(300).annotate({
      description: "More on why the default fits, in full sentences. Can be hidden by the user."
    })
  ),
  advanced: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: "Fold this field into the collapsed Details section."
    })
  )
}

const TextField = Schema.Struct({
  type: Schema.Literal("text"),
  ...commonFields,
  default: Schema.optionalKey(text(500)),
  placeholder: Schema.optionalKey(text(80)),
  multiline: Schema.optionalKey(Schema.Boolean)
})

const NumberField = Schema.Struct({
  type: Schema.Literal("number"),
  ...commonFields,
  default: Schema.optionalKey(Schema.Finite),
  min: Schema.Finite,
  max: Schema.Finite,
  step: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
  prefix: Schema.optionalKey(text(8)),
  suffix: Schema.optionalKey(text(8))
})

const ChoiceOption = Schema.Struct({
  value: required(60),
  label: required(60),
  description: Schema.optionalKey(
    text(60).annotate({ description: "One sentence on what this option is or what happens if chosen. Always shown." })
  ),
  details: Schema.optionalKey(
    text(300).annotate({
      description: "More on this option in full sentences, such as its trade-offs or implications. Can be hidden by the user."
    })
  )
})

const choiceFields = {
  type: Schema.Literal("choice"),
  ...commonFields,
  default: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  multiple: Schema.optionalKey(Schema.Boolean)
}

const options = <S extends Schema.Top>(option: S) => Schema.Array(option).check(Schema.isMinLength(2), Schema.isMaxLength(12))

const NestedChoiceField = Schema.Struct({ ...choiceFields, options: options(ChoiceOption) })

const ToggleField = Schema.Struct({
  type: Schema.Literal("toggle"),
  ...commonFields,
  default: Schema.optionalKey(Schema.Boolean),
  note: Schema.optionalKey(text(40))
})

const NestedField = Schema.Union([TextField, NumberField, NestedChoiceField, ToggleField])

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

const Field = Schema.Union([TextField, NumberField, ChoiceField, ToggleField])

const Computed = Schema.Struct({
  id: Identifier,
  label: required(60),
  expression: required(300).annotate({
    description:
      "Arithmetic over field ids and earlier computed ids. Operators + - * / % < <= > >= == != && || ! ?: and min max abs floor ceil round."
  }),
  prefix: Schema.optionalKey(text(8)),
  suffix: Schema.optionalKey(text(8)),
  decimals: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }))),
  primary: Schema.optionalKey(Schema.Boolean)
})

export const FormSpec = Schema.Struct({
  title: required(80),
  description: Schema.optionalKey(text(300)),
  fields: Schema.Array(Field).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  computed: Schema.optionalKey(Schema.Array(Computed).check(Schema.isMaxLength(8))),
  submitLabel: Schema.optionalKey(text(20))
})

export type TextField = typeof TextField.Type
export type NumberField = typeof NumberField.Type
export type ChoiceField = typeof ChoiceField.Type
export type ToggleField = typeof ToggleField.Type
export type Field = typeof Field.Type
export type Computed = typeof Computed.Type
export type FormSpec = typeof FormSpec.Type
