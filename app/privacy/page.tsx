import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Политика за поверителност - Ovva Sculpt",
  description: "Политика за поверителност и защита на личните данни на Ovva Sculpt.",
}

export default function PrivacyPage() {
  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Политика за поверителност</h1>
        <p className="mt-4 text-sm text-muted-foreground">Последна актуализация: Януари 2026</p>

        <div className="mt-8 space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Въведение</h2>
            <p className="mt-4">
              Ovva Sculpt се ангажира да защитава поверителността на вашите лични данни. 
              Тази политика описва как събираме, използваме и защитаваме вашата информация 
              при използване на нашия уебсайт и услуги.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Какви данни събираме</h2>
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
            <h2 className="text-xl font-semibold text-foreground">3. Как използваме данните</h2>
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
            <h2 className="text-xl font-semibold text-foreground">4. Споделяне на данни</h2>
            <div className="mt-4 space-y-4">
              <p>Споделяме вашите данни само с:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>Куриерска фирма Speedy - за доставка на поръчки</li>
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
            <h2 className="text-xl font-semibold text-foreground">5. Сигурност на данните</h2>
            <p className="mt-4">
              Прилагаме подходящи технически и организационни мерки за защита на вашите 
              данни от неоторизиран достъп, загуба или унищожаване. Плащанията се обработват 
              чрез защитената платформа Stripe, която е сертифицирана по PCI DSS стандарт.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Вашите права</h2>
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
                За да упражните тези права, свържете се с нас на info@ovvasculpt.com.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Бисквитки (Cookies)</h2>
            <p className="mt-4">
              Използваме бисквитки за подобряване на потребителското изживяване и анализ 
              на трафика. Можете да контролирате бисквитките чрез настройките на вашия браузър.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">8. Контакт</h2>
            <p className="mt-4">
              При въпроси относно тази политика или обработката на вашите данни:
              <br />
              Имейл: info@ovvasculpt.com
              <br />
              Телефон: +359 888 123 456
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
