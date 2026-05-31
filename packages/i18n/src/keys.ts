import zhCN from "./locales/zh-CN.json";

type Join<Key, Path> = Key extends string
  ? Path extends string
    ? `${Key}.${Path}`
    : never
  : never;

type LeafKeys<T> = T extends string
  ? never
  : {
      [Key in keyof T & string]: T[Key] extends string
        ? Key
        : Join<Key, LeafKeys<T[Key]>>;
    }[keyof T & string];

export type I18nKey = LeafKeys<typeof zhCN>;

export function i18nKey<Key extends I18nKey>(key: Key): Key {
  return key;
}
