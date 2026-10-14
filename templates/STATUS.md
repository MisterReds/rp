# STATUS: ПМ.0N, группа …

## Запрос
- ПМ / группа / специальность:
- Файлы человека (что есть что):
- Особые указания (дословно):

## Данные
| Что | Файл | Кто | Проверка | Итог |
|---|---|---|---|---|
| Учебный план | data/plans/… | plan-reader | check_plan.py | |
| ФГОС | data/fgos/… | fgos-extractor | verify_sources.py | |
| ПОП | data/pop/… | pop-extractor | verify_sources.py --cover | |
| Воспитание | data/vospitanie/… | vospitanie-extractor | verify_sources.py | |
| Перенос МДК | — / content.json | mdk-importer | validate | |

## Каркас
- init: замечания — нет / …
- project.json: реквизиты заполнены — да / нет (что пусто)

## Этапы
| Этап | Кто | Попыток | Итог |
|---|---|---|---|
| themes:… | content-writer | | |

## Сборка и проверка
- validate: | lint: | build: | check_docx:
- REVIEW.md: ПРИНЯТО / НА ДОРАБОТКУ (круг N)

## Открытые вопросы человеку
- 

## Проверить человеку
- 
