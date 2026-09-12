# Add-on de Home Assistant OS

El complemento **es la raíz del repo**, no esta carpeta.

En el G3 Plus (HAOS) no instalas Docker. Copias el repo a `/addons/centinela` (Samba o git) y Supervisor instala el add-on. El `Dockerfile` de la raíz lo usa Supervisor por detrás; tú no lo ejecutas.

Ver [README.md](../README.md) sección «Producción en HAOS».
