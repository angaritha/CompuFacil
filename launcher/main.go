// CompuFácil.exe — lanzador de un solo clic.
//
// Enciende el servicio de IA + panel (Python/FastAPI) y el bot de WhatsApp
// (Node/wppconnect) en una sola ventana, revisa dependencias, comprueba la
// clave y el cupo de Groq y abre el panel. Al cerrar la ventana se apaga todo.
//
// Compilar (desde Linux o Windows):
//
//	GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o ../CompuFacil.exe
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	healthURL   = "http://localhost:8000/health"
	statusURL   = "http://localhost:8000/api/ia-status?force=true"
	panelURL    = "http://localhost:8000/panel"
	reset       = "\x1b[0m"
	bold        = "\x1b[1m"
	dim         = "\x1b[2m"
	red         = "\x1b[38;2;224;101;108m"
	green       = "\x1b[38;2;108;193;146m"
	yellow      = "\x1b[38;2;226;176;79m"
	gray        = "\x1b[38;2;143;137;130m"
	accentBadge = "\x1b[48;2;179;38;46m\x1b[97m"
)

var (
	root    string
	outMu   sync.Mutex
	ansiRe  = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	job     windows.Handle
	logDir  string
	running []*exec.Cmd
	doneOf  = map[*exec.Cmd]chan struct{}{}
)

func main() {
	setupConsole()
	exe, _ := os.Executable()
	root = filepath.Dir(exe)
	if !fileExists(filepath.Join(root, "ia", "main.py")) {
		// Permite ejecutarlo con "go run" desde la carpeta launcher/.
		if wd, _ := os.Getwd(); fileExists(filepath.Join(wd, "..", "ia", "main.py")) {
			root = filepath.Clean(filepath.Join(wd, ".."))
		}
	}
	banner()

	if !fileExists(filepath.Join(root, "ia", "main.py")) || !fileExists(filepath.Join(root, "bot", "bot.js")) {
		fail("No encuentro las carpetas ia\\ y bot\\. Deja CompuFacil.exe dentro de la carpeta del proyecto.")
	}
	logDir = filepath.Join(root, "logs")
	_ = os.MkdirAll(logDir, 0o755)
	setupJob()

	if ping(healthURL, 1500) {
		step("!", yellow, "CompuFácil ya está encendido en este PC (otra ventana). Abro el panel.")
		openBrowser(panelURL)
		pause()
		return
	}

	// ---- 1. Dependencias -------------------------------------------------
	py := findPython()
	node, err := exec.LookPath("node")
	if err != nil {
		fail("No encuentro Node.js. Instálalo desde https://nodejs.org (versión LTS) y vuelve a abrir CompuFácil.")
	}
	step("1", gray, "Revisando dependencias…")
	ensurePython(py)
	ensureNode()
	setTitle("CompuFácil")

	// ---- 2. Servicio de IA y panel ---------------------------------------
	step("2", gray, "Encendiendo el motor de IA y el panel…")
	ia := start("IA ", green, filepath.Join(root, "ia"), "ia.log", filterIA, py, "-u", "main.py")
	if !waitHealth(90 * time.Second) {
		fail("El servicio de IA no arrancó. Revisa el registro en logs\\ia.log")
	}
	step("✓", green, "Motor de IA y panel listos → "+panelURL)

	// ---- 3. Estado de Groq -----------------------------------------------
	step("3", gray, "Revisando la clave y el cupo de la IA (Groq)…")
	checkGroq()

	// ---- 4. Bot de WhatsApp ----------------------------------------------
	step("4", gray, "Conectando el bot de WhatsApp…")
	bot := start("BOT", yellow, filepath.Join(root, "bot"), "bot.log", filterBot, node, "bot.js")

	go func() {
		time.Sleep(4 * time.Second)
		openBrowser(panelURL)
	}()

	fmt.Println()
	outMu.Lock()
	fmt.Println(dim + "  Deja esta ventana abierta mientras uses el bot. Para apagar todo: ciérrala o presiona Ctrl+C." + reset)
	fmt.Println(dim + "  Si aparece un código QR, escanéalo desde WhatsApp → Dispositivos vinculados." + reset)
	fmt.Println()
	outMu.Unlock()

	// ---- Espera y apagado -----------------------------------------------
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	iaDone := wait(ia)
	botDone := wait(bot)

	select {
	case <-sig:
		step("■", gray, "Apagando CompuFácil…")
		shutdown(5 * time.Second)
		return
	case <-iaDone:
		step("✗", red, "El motor de IA se detuvo. Revisa logs\\ia.log")
	case <-botDone:
		step("✗", red, "El bot de WhatsApp se detuvo. Revisa logs\\bot.log (si fue por el QR, vuelve a abrir CompuFácil).")
	}
	shutdown(3 * time.Second)
	pause()
}

// ---------------------------------------------------------------------------
// Procesos
// ---------------------------------------------------------------------------

type lineFilter func(clean string) (show bool, color string)

func start(tag, color, dir, logName string, filter lineFilter, name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8", "PYTHONUNBUFFERED=1", "FORCE_COLOR=0")
	logf, _ := os.OpenFile(filepath.Join(logDir, logName), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if logf != nil {
		fmt.Fprintf(logf, "\n===== %s =====\n", time.Now().Format("2006-01-02 15:04:05"))
	}
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		fail(fmt.Sprintf("No se pudo iniciar %s: %v", name, err))
	}
	addToJob(cmd)
	running = append(running, cmd)
	done := make(chan struct{})
	doneOf[cmd] = done

	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 1024*1024), 1024*1024)
		for sc.Scan() {
			raw := sc.Text()
			clean := strings.TrimRight(ansiRe.ReplaceAllString(raw, ""), " \r")
			if logf != nil {
				fmt.Fprintln(logf, clean)
			}
			if show, c := filter(clean); show {
				if c == "" {
					c = reset
				}
				outMu.Lock()
				fmt.Printf("  %s%s%s %s│%s %s%s%s\n", color, tag, reset, gray, reset, c, clean, reset)
				outMu.Unlock()
			}
		}
	}()
	go func() {
		_ = cmd.Wait()
		_ = pw.Close()
		close(done)
	}()
	return cmd
}

func wait(cmd *exec.Cmd) <-chan struct{} { return doneOf[cmd] }

func exited(cmd *exec.Cmd) bool {
	select {
	case <-doneOf[cmd]:
		return true
	default:
		return false
	}
}

func shutdown(grace time.Duration) {
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		alive := false
		for _, c := range running {
			if !exited(c) {
				alive = true
			}
		}
		if !alive {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	for _, c := range running {
		if !exited(c) && c.Process != nil {
			_ = c.Process.Kill()
		}
	}
}

// Filtros: muestran lo útil y dejan el detalle técnico en logs\.
var accessRe = regexp.MustCompile(`"(GET|POST|PATCH|PUT|DELETE) [^"]*" (\d{3})`)

func filterIA(s string) (bool, string) {
	t := strings.TrimSpace(s)
	switch {
	case t == "":
		return false, ""
	case accessRe.MatchString(t):
		code := accessRe.FindStringSubmatch(t)[2]
		if code[0] == '5' {
			return true, red
		}
		return false, ""
	case strings.Contains(t, "HTTP Request:"), strings.Contains(t, "DeprecationWarning"),
		strings.Contains(t, "on_event"), strings.Contains(t, "lifespan"), strings.HasPrefix(t, "@app"),
		strings.HasPrefix(t, "Read more"), strings.HasPrefix(t, "[FastAPI docs"),
		strings.Contains(t, "Waiting for application"), strings.Contains(t, "Started server process"),
		strings.Contains(t, "Application startup complete"), strings.Contains(t, "Press CTRL+C"),
		strings.Contains(t, "Base de datos lista"), strings.Contains(t, "Panel: http"):
		return false, ""
	case strings.Contains(t, "ERROR"), strings.Contains(t, "Traceback"), strings.Contains(t, "Error"):
		return true, red
	case strings.Contains(t, "WARNING"):
		return true, yellow
	}
	return true, dim
}

var (
	botNoise = regexp.MustCompile(`^(debug|http|silly|verbose|info)\s*:`)
	asciiArt = regexp.MustCompile(`^[\s_/\\|()'.,\-]+$`)
	botQuiet = []string{"failed to check for updates"}
)

func filterBot(s string) (bool, string) {
	t := strings.TrimSpace(s)
	low := strings.ToLower(t)
	switch {
	case t == "":
		return false, ""
	case botNoise.MatchString(low) && !strings.Contains(low, "error") && !strings.Contains(low, "qr"):
		return false, ""
	case asciiArt.MatchString(t):
		return false, ""
	case containsAny(low, botQuiet):
		return false, ""
	case strings.HasPrefix(low, "error"), strings.Contains(t, "⚠"), strings.Contains(low, "no se pudo"):
		return true, yellow
	}
	return true, ""
}

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

func findPython() string {
	for _, p := range []string{
		filepath.Join(root, "ia", "venv", "Scripts", "python.exe"),
		filepath.Join(root, "venv", "Scripts", "python.exe"),
	} {
		if fileExists(p) {
			return p
		}
	}
	for _, n := range []string{"python", "py"} {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	fail("No encuentro Python. Instálalo desde https://python.org (marca \"Add to PATH\").")
	return ""
}

func ensurePython(py string) {
	req := filepath.Join(root, "ia", "requirements.txt")
	stamp := filepath.Join(root, ".compufacil", "py-"+hashFile(req)+"-"+hashString(py))
	if fileExists(stamp) {
		step("·", gray, "Python: dependencias al día")
		return
	}
	step("·", gray, "Python: instalando dependencias (solo esta vez)…")
	cmd := exec.Command(py, "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", req)
	if out, err := cmd.CombinedOutput(); err != nil {
		appendLog("setup.log", string(out))
		step("!", yellow, "No se pudieron instalar todas las dependencias de Python (ver logs\\setup.log). Sigo de todos modos.")
		return
	}
	touch(stamp)
}

func ensureNode() {
	pkg := filepath.Join(root, "bot", "package.json")
	stamp := filepath.Join(root, ".compufacil", "npm-"+hashFile(pkg))
	if fileExists(stamp) && fileExists(filepath.Join(root, "bot", "node_modules")) {
		step("·", gray, "Bot: dependencias al día")
		return
	}
	step("·", gray, "Bot: instalando dependencias (puede tardar un par de minutos)…")
	cmd := exec.Command("cmd", "/c", "npm install --no-audit --no-fund --loglevel=error")
	cmd.Dir = filepath.Join(root, "bot")
	if out, err := cmd.CombinedOutput(); err != nil {
		appendLog("setup.log", string(out))
		if !fileExists(filepath.Join(root, "bot", "node_modules")) {
			fail("No se pudieron instalar las dependencias del bot (ver logs\\setup.log). Revisa el internet.")
		}
		step("!", yellow, "npm reportó un problema (ver logs\\setup.log). Sigo con lo instalado.")
		return
	}
	touch(stamp)
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

type iaStatus struct {
	State     string  `json:"state"`
	Message   string  `json:"message"`
	Model     string  `json:"model"`
	Limit     *int    `json:"requests_day_limit"`
	Remaining *int    `json:"requests_day_remaining"`
	ResetIn   *string `json:"requests_reset_in"`
}

func checkGroq() {
	client := http.Client{Timeout: 35 * time.Second}
	resp, err := client.Get(statusURL)
	if err != nil {
		step("!", yellow, "No pude revisar el estado de Groq. El tutor usará respuestas de contingencia si falla.")
		return
	}
	defer resp.Body.Close()
	var st iaStatus
	if json.NewDecoder(resp.Body).Decode(&st) != nil {
		step("!", yellow, "Respuesta inesperada al revisar Groq.")
		return
	}
	switch st.State {
	case "ok":
		step("✓", green, st.Message)
	case "bajo":
		step("!", yellow, st.Message+" (queda poco cupo hoy)")
	default:
		step("✗", red, st.Message)
		if st.State == "clave_invalida" || st.State == "sin_clave" {
			fmt.Println(dim + "      Crea una clave gratis en https://console.groq.com/keys y ponla en ia\\.env como GROQ_API_KEY=..." + reset)
		}
		fmt.Println(dim + "      El bot seguirá funcionando; el tutor responderá con contenido local hasta que Groq vuelva." + reset)
	}
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

func waitHealth(max time.Duration) bool {
	deadline := time.Now().Add(max)
	for time.Now().Before(deadline) {
		if ping(healthURL, 1500) {
			return true
		}
		time.Sleep(700 * time.Millisecond)
	}
	return false
}

func ping(url string, ms int) bool {
	c := http.Client{Timeout: time.Duration(ms) * time.Millisecond}
	r, err := c.Get(url)
	if err != nil {
		return false
	}
	r.Body.Close()
	return r.StatusCode == 200
}

func openBrowser(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func hashFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return "x"
	}
	return hashString(string(b))
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])[:12]
}

func touch(p string) {
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	// Deja solo la marca vigente de cada tipo.
	prefix := strings.SplitN(filepath.Base(p), "-", 2)[0] + "-"
	if old, _ := filepath.Glob(filepath.Join(filepath.Dir(p), prefix+"*")); old != nil {
		for _, o := range old {
			_ = os.Remove(o)
		}
	}
	_ = os.WriteFile(p, []byte(time.Now().Format(time.RFC3339)), 0o644)
}

func appendLog(name, text string) {
	f, err := os.OpenFile(filepath.Join(logDir, name), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		fmt.Fprintf(f, "\n===== %s =====\n%s\n", time.Now().Format("2006-01-02 15:04:05"), text)
		f.Close()
	}
}

func containsAny(s string, subs []string) bool {
	for _, x := range subs {
		if strings.Contains(s, x) {
			return true
		}
	}
	return false
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func banner() {
	fmt.Println()
	fmt.Println("  " + accentBadge + bold + "  CompuFácil  " + reset + "  " + bold + "Chatbot educativo de hardware" + reset)
	fmt.Println("  " + gray + "Fundación Universitaria San Mateo · Especialización en Docencia" + reset)
	fmt.Println()
}

func step(icon, color, msg string) {
	outMu.Lock()
	defer outMu.Unlock()
	fmt.Printf("  %s%s%s  %s\n", color+bold, icon, reset, msg)
}

func fail(msg string) {
	step("✗", red, msg)
	shutdown(2 * time.Second)
	pause()
	os.Exit(1)
}

func pause() {
	fmt.Println()
	fmt.Print(dim + "  Presiona Enter para cerrar…" + reset)
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

// ---------------------------------------------------------------------------
// Windows: consola UTF-8 con colores, título y "Job" para que al cerrar la
// ventana se apaguen también Python y Node.
// ---------------------------------------------------------------------------

func setupConsole() {
	k32 := windows.NewLazySystemDLL("kernel32.dll")
	k32.NewProc("SetConsoleOutputCP").Call(65001)
	k32.NewProc("SetConsoleCP").Call(65001)
	setTitle("CompuFácil")
	h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE)
	if err == nil {
		var mode uint32
		if windows.GetConsoleMode(h, &mode) == nil {
			_ = windows.SetConsoleMode(h, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)
		}
	}
}

func setTitle(t string) {
	title, _ := windows.UTF16PtrFromString(t)
	windows.NewLazySystemDLL("kernel32.dll").NewProc("SetConsoleTitleW").Call(uintptr(unsafe.Pointer(title)))
}

func setupJob() {
	j, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(j, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(j)
		return
	}
	job = j
}

func addToJob(cmd *exec.Cmd) {
	if job == 0 || cmd.Process == nil {
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return
	}
	_ = windows.AssignProcessToJobObject(job, h)
	windows.CloseHandle(h)
}
