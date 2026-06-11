using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

const string TrailerMagic = "AMZPAYLD";
const int TrailerSize = 16;

var processPath = Environment.ProcessPath
  ?? Process.GetCurrentProcess().MainModule?.FileName
  ?? throw new InvalidOperationException("Cannot determine bootstrapper path.");

var extractRoot = Path.Combine(
  Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
  "AmzUS",
  "bundle");

var payload = ReadEmbeddedPayload(processPath);
var payloadHash = Convert.ToHexString(SHA256.HashData(payload));
var markerPath = Path.Combine(extractRoot, ".payload.sha256");

if (!IsCurrentBundle(extractRoot, markerPath, payloadHash))
{
  if (Directory.Exists(extractRoot))
  {
    Directory.Delete(extractRoot, recursive: true);
  }

  Directory.CreateDirectory(extractRoot);
  ExtractZipPayload(payload, extractRoot);
  File.WriteAllText(markerPath, payloadHash, Encoding.UTF8);
}

var qodePath = Path.Combine(extractRoot, "qode.exe");
var mainJsPath = Path.Combine(extractRoot, "main.js");
var nodeguiAddonDir = Path.Combine(extractRoot, "node_modules", "@nodegui", "nodegui", "build", "Release");

if (!File.Exists(qodePath))
{
  throw new FileNotFoundException($"Missing qode runtime: {qodePath}");
}

if (!File.Exists(mainJsPath))
{
  throw new FileNotFoundException($"Missing app entrypoint: {mainJsPath}");
}

var startInfo = new ProcessStartInfo
{
  FileName = qodePath,
  Arguments = $"\"{mainJsPath}\"",
  WorkingDirectory = extractRoot,
  UseShellExecute = false
};

startInfo.Environment["PATH"] =
  string.Join(
    Path.PathSeparator,
    new[]
    {
      extractRoot,
      nodeguiAddonDir,
      Environment.GetEnvironmentVariable("PATH") ?? string.Empty
    }.Where(s => !string.IsNullOrWhiteSpace(s)));

using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start app.");
process.WaitForExit();
Environment.ExitCode = process.ExitCode;

static bool IsCurrentBundle(string extractRoot, string markerPath, string expectedHash)
{
  if (!File.Exists(Path.Combine(extractRoot, "qode.exe")) || !File.Exists(Path.Combine(extractRoot, "main.js")))
  {
    return false;
  }

  if (!File.Exists(markerPath))
  {
    return false;
  }

  try
  {
    var actualHash = File.ReadAllText(markerPath, Encoding.UTF8).Trim();
    return actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase);
  }
  catch
  {
    return false;
  }
}

static byte[] ReadEmbeddedPayload(string selfPath)
{
  using var stream = new FileStream(selfPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
  if (stream.Length < TrailerSize)
  {
    throw new InvalidDataException("Bootstrapper payload trailer is missing.");
  }

  stream.Seek(-TrailerSize, SeekOrigin.End);
  var trailer = new byte[TrailerSize];
  ReadExactly(stream, trailer, 0, trailer.Length);

  var magic = Encoding.ASCII.GetString(trailer, 0, 8);
  if (!magic.Equals(TrailerMagic, StringComparison.Ordinal))
  {
    throw new InvalidDataException("Bootstrapper payload marker is invalid.");
  }

  var payloadLength = BitConverter.ToInt64(trailer, 8);
  if (payloadLength <= 0 || payloadLength > stream.Length - TrailerSize)
  {
    throw new InvalidDataException("Bootstrapper payload length is invalid.");
  }

  stream.Seek(-(TrailerSize + payloadLength), SeekOrigin.End);
  var payload = new byte[payloadLength];
  ReadExactly(stream, payload, 0, payload.Length);
  return payload;
}

static void ExtractZipPayload(byte[] payload, string destination)
{
  using var input = new MemoryStream(payload);
  using var archive = new ZipArchive(input, ZipArchiveMode.Read);

  foreach (var entry in archive.Entries)
  {
    var normalized = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
    var targetPath = Path.Combine(destination, normalized);

    if (string.IsNullOrWhiteSpace(entry.Name))
    {
      Directory.CreateDirectory(targetPath);
      continue;
    }

    Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
    entry.ExtractToFile(targetPath, overwrite: true);
  }
}

static void ReadExactly(Stream stream, byte[] buffer, int offset, int count)
{
  var read = 0;
  while (read < count)
  {
    var n = stream.Read(buffer, offset + read, count - read);
    if (n <= 0)
    {
      throw new EndOfStreamException();
    }
    read += n;
  }
}
