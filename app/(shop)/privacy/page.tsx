import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Политика за поверителност - Egg Origin",
  description: "Политика за поверителност и защита на личните данни на Egg Origin.",
}

export default function PrivacyPage() {
  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Правна информация
        </p>
        <h1 className="mt-6 text-3xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-4xl">Политика за поверителност</h1>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">Последна актуализация: Януари 2026</p>

        <div className="mt-8 max-w-prose space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">1. Въведение</h2>
            <p className="mt-4">
              Egg Origin се ангажира да защитава поверителността на вашите лични данни. 
              Тази политика описва как събираме, използваме и защитаваме вашата информация 
              при използване на нашия уебсайт и услуги.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">2. Какви данни събираме</h2>
            <div className="mt-4 space-y-4">
              <p>При правене на поръчка събираме следните данни:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Име и фамилия</li>
                <li>Имейл адрес</li>
                <li>Телефонен номер</li>
                <li>Адрес за доставка</li>
                <li>Информация за плащане (обработва се директно от Stripe)</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">3. Как използваме данните</h2>
            <div className="mt-4 space-y-4">
              <p>Използваме вашите данни за:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Обработка и доставка на поръчки</li>
                <li>Комуникация относно статуса на поръчката</li>
                <li>Отговаряне на запитвания</li>
                <li>Изпращане на маркетингови съобщения (само с ваше съгласие)</li>
                <li>Подобряване на нашите услуги</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">4. Споделяне на данни</h2>
            <div className="mt-4 space-y-4">
              <p>Споделяме вашите данни само с:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Куриерски фирми Speedy и Еконт - за доставка на поръчки</li>
                <li>Stripe - за обработка на плащания</li>
                <li>Vercel - за хостинг на уебсайта</li>
                <li>Supabase - за съхранение на данни</li>
              </ul>
              <p>
                Не продаваме и не предоставяме вашите лични данни на трети страни за 
                маркетингови цели.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">5. Сигурност на данните</h2>
            <p className="mt-4">
              Прилагаме подходящи технически и организационни мерки за защита на вашите 
              данни от неоторизиран достъп, загуба или унищожаване. Плащанията се обработват 
              чрез защитената платформа Stripe, която е сертифицирана по PCI DSS стандарт.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">6. Вашите права</h2>
            <div className="mt-4 space-y-4">
              <p>Съгласно GDPR, вие имате право на:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Достъп до вашите лични данни</li>
                <li>Коригиране на неточни данни</li>
                <li>Изтриване на данни (&quot;правото да бъдеш забравен&quot;)</li>
                <li>Ограничаване на обработката</li>
                <li>Преносимост на данните</li>
                <li>Възражение срещу обработка</li>
              </ul>
              <p>
                За да упражните тези права, свържете се с нас на info@eggorigin.com.
              </p>
            </div>
          </section>

          <section id="cookies">
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">7. Бисквитки и локално съхранение</h2>
            <div className="mt-4 space-y-4">
              <p>
                Нашият сайт използва бисквитки и локално съхранение (localStorage) за различни
                цели. При първото ви посещение ще бъдете помолени да дадете съгласие за
                аналитичните бисквитки.
              </p>

              <div>
                <h3 className="font-medium text-foreground">Необходими (без съгласие)</h3>
                <ul className="mt-2 list-disc space-y-2 pl-6">
                  <li>
                    <strong>Количка</strong> — съхраняваме съдържанието на количката ви в localStorage,
                    за да запазим избраните продукти между посещенията. Не съдържа лични данни.
                  </li>
                  <li>
                    <strong>Съгласие за бисквитки</strong> — запомняме вашия избор (приемане/отказ)
                    в localStorage, за да не ви питаме повторно.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-medium text-foreground">Аналитични (с ваше съгласие)</h3>
                <ul className="mt-2 list-disc space-y-2 pl-6">
                  <li>
                    <strong>Vercel Analytics</strong> — използваме Vercel Analytics за анализ на
                    трафика и подобряване на сайта. Тази услуга се активира само ако дадете
                    съгласие чрез банера за бисквитки. Vercel Analytics е проектиран да е
                    съобразен с поверителността и не използва бисквитки за проследяване между сайтове.
                  </li>
                </ul>
              </div>

              <p>
                Можете да оттеглите съгласието си по всяко време, като изчистите данните на
                сайта от настройките на браузъра си. При следващото посещение банерът за
                бисквитки ще се покаже отново.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-medium tracking-[-0.01em] text-foreground sm:text-lg">8. Контакт</h2>
            <p className="mt-4">
              При въпроси относно тази политика или обработката на вашите данни:
              <br />
              Имейл: info@eggorigin.com
              <br />
              Телефон: +359 888 123 456
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
