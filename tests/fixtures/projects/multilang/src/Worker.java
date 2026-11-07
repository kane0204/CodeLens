import java.io.File;

class Worker {
  static String token = "REAL_SECRET_12345";

  static int run(int value) {
    if (value > 0) {
      Runtime.getRuntime().exec("worker.exe");
      return value + 1;
    }
    // TODO replace the temporary executable
    return 0;
  }
}
