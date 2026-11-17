import { Schema } from "effect"

const text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const required = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const Identifier = Schema.String.check(Schema.isMaxLength(40), Schema.isPattern(/^(?!(?:true|false)$)[A-Za-z_][A-Za-z0-9_]*$/)).annotate({
  description: "Unique identifier: letters, digits and underscore, starting with a letter or underscore; true and false are reserved."
})

const options = <S extends Schema.Top>(option: S) => Schema.Array(option).check(Schema.isMinLength(2), Schema.isMaxLength(6))

const shownTexts = (scale: number) => ({
  shown: (max: number) => text(max * scale),
  shownRequired: (max: number) => required(max * scale)
})

type ShownTexts = ReturnType<typeof shownTexts>

const commonFieldsOf = ({ shown, shownRequired }: ShownTexts) => ({
  id: Identifier,
  label: shownRequired(60).annotate({ description: "Label shown to the user, in the user's language." }),
  description: Schema.optionalKey(
    shown(120).annotate({
      description: "What this question asks or what the value is used for, independent of your recommendation. Shown under the label."
    })
  ),
  reason: Schema.optionalKey(
    shown(60).annotate({
      description:
        "One sentence on why you recommend the default for this situation, citing what you found. Shown with the recommended value. Only allowed together with default."
    })
  ),
  reasonDetails: Schema.optionalKey(
    shown(300).annotate({
      description:
        "More on why you recommend the default, in full sentences. Can be hidden by the user. Only allowed together with default."
    })
  ),
  advanced: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: "Fold this field into the collapsed Details section."
    })
  )
})

const choiceOptionOf = ({ shown, shownRequired }: ShownTexts) =>
  Schema.Struct({
    value: required(60),
    label: shownRequired(60),
    description: Schema.optionalKey(
      shown(60).annotate({ description: "One sentence on what this option is or what happens if chosen. Always shown." })
    ),
    details: Schema.optionalKey(
      shown(300).annotate({
        description: "More on this option in full sentences, such as its trade-offs or implications. Can be hidden by the user."
      })
    )
  })

const computedOf = ({ shownRequired }: ShownTexts) =>
  Schema.Struct({
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

const fieldsOf = (texts: ShownTexts) => {
  const commonFields = commonFieldsOf(texts)

  const TextField = Schema.Struct({
    type: Schema.Literal("text"),
    ...commonFields,
    default: Schema.optionalKey(text(500)),
    placeholder: Schema.optionalKey(texts.shown(80)),
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

  const ChoiceOption = choiceOptionOf(texts)

  const choiceFields = {
    type: Schema.Literal("choice"),
    ...commonFields,
    default: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    multiple: Schema.optionalKey(Schema.Boolean)
  }

  const NestedChoiceField = Schema.Struct({ ...choiceFields, options: options(ChoiceOption) })

  const NestedField = Schema.Union([TextField, NumberField, NestedChoiceField])

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

  return { TextField, NumberField, ChoiceField, Field: Schema.Union([TextField, NumberField, ChoiceField]) }
}

const formSpec = (scale: number) => {
  const texts = shownTexts(scale)
  const fields = fieldsOf(texts)
  const Computed = computedOf(texts)
  const FormSpec = Schema.Struct({
    title: texts.shownRequired(80),
    description: Schema.optionalKey(texts.shown(300)),
    fields: Schema.Array(fields.Field).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    computed: Schema.optionalKey(Schema.Array(Computed).check(Schema.isMaxLength(8)))
  })
  return { ...fields, Computed, FormSpec }
}

const accepted = formSpec(2)

export const AdvertisedFormSpec = formSpec(1).FormSpec

export const FormSpec = accepted.FormSpec

export type TextField = typeof accepted.TextField.Type
export type NumberField = typeof accepted.NumberField.Type
export type ChoiceField = typeof accepted.ChoiceField.Type
export type Field = typeof accepted.Field.Type
export type Computed = typeof accepted.Computed.Type
export type FormSpec = typeof FormSpec.Type
