# Lanzador CompuFacil.exe

Código del ejecutable de un clic. Solo hace falta si quieres modificarlo.

Compilar (con Go 1.22 o superior):

```bash
cd launcher
go mod tidy
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ../CompuFacil.exe .
```

En Windows (PowerShell): `$env:GOOS="windows"; go build -trimpath -ldflags "-s -w" -o ..\CompuFacil.exe .`

`rsrc_windows_amd64.syso` contiene el ícono (`compufacil.ico`).
