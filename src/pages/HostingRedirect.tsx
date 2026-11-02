import { useEffect } from "react";

/** Keep the legacy portal URL usable without forwarding query strings or tokens. */
export default function HostingRedirect() {
  useEffect(() => {
    window.location.replace("https://hosting.i3alumba.ru/");
  }, []);
  return <a href="https://hosting.i3alumba.ru/">Open Ubuntu Hosting</a>;
}
