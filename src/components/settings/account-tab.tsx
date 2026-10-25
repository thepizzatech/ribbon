import { CalendarSection, MyPersonSection, PasskeySection, SsoSection } from "@/components/settings/account-extras";

export function AccountExtras() {
  return (
    <>
      <MyPersonSection />
      <PasskeySection />
      <SsoSection />
      <CalendarSection />
    </>
  );
}
