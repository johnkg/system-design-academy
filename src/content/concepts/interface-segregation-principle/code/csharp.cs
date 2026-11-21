// Interface Segregation Principle: a device family (print, scan, fax) with five clients, built with three kinds of interface.
// Then three changes arrive: a new method (staple), a new device type (LabelPrinter) and a changed signature (print).
// Look for: stub methods devices are forced to write, existing clients hit by each change, and how many interfaces exist.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Item(string Name, List<string> Methods); // a client, a device or an interface

    static readonly Dictionary<string, string> RoleOf = new()
    {
        ["print"] = "Printing", ["setPaper"] = "Printing", ["scan"] = "Scanning", ["scanToEmail"] = "Scanning", ["fax"] = "Faxing",
        ["faxStatus"] = "Faxing", ["status"] = "Admin", ["reset"] = "Admin", ["staple"] = "Finishing",
    };
    static readonly Item[] Clients = // what each client calls
    {
        new("PrintDialog", new() { "print", "setPaper" }),
        new("ScanToEmail", new() { "scan", "scanToEmail" }),
        new("FaxDesk", new() { "fax", "faxStatus" }),
        new("CopyShortcut", new() { "scan", "print" }),
        new("HealthMonitor", new() { "status", "reset" }),
    };
    static readonly string[] StartMethods = { "print", "setPaper", "scan", "scanToEmail", "fax", "faxStatus", "status", "reset" };

    // An interface is (name, methods). Fat: one for everything. Roles: one per client need. Per method: one each.
    static List<Item> Interfaces(string mode, List<string> methods)
    {
        if (mode == "fat") return new() { new("Device", new List<string>(methods)) };
        if (mode == "per-method") return methods.Select(m => new Item("I" + char.ToUpper(m[0]) + m.Substring(1), new() { m })).ToList();
        var outList = new List<Item>();
        foreach (var m in methods)
        {
            var r = outList.FirstOrDefault(x => x.Name == RoleOf[m]);
            if (r == null) { r = new Item(RoleOf[m], new()); outList.Add(r); }
            r.Methods.Add(m);
        }
        return outList;
    }

    static bool Overlaps(Item a, Item b) => a.Methods.Any(m => b.Methods.Contains(m));
    // A device must implement every method of each interface it takes part in: the ones it cannot do become stubs.
    static int StubsOf(Item device, List<Item> ifaces) => ifaces.Where(i => Overlaps(device, i)).Sum(i => i.Methods.Count(m => !device.Methods.Contains(m)));
    static int TotalStubs(List<Item> devices, List<Item> ifaces) => devices.Sum(d => StubsOf(d, ifaces));
    // Methods a client can see through its interfaces but never calls.
    static int Noise(List<Item> ifaces) => Clients.Sum(c => ifaces.Where(i => Overlaps(c, i)).Sum(i => i.Methods.Count(m => !c.Methods.Contains(m))));
    static Item? Find(List<Item> ifaces, string name) => ifaces.FirstOrDefault(o => o.Name == name);

    public static void Main()
    {
        foreach (var (title, mode) in new[] { ("One fat interface", "fat"), ("Role interfaces by client need", "role"), ("One method per interface", "per-method") })
        {
            var methods = new List<string>(StartMethods);
            var devices = new List<Item>
            {
                new("BasicPrinter", new() { "print", "setPaper", "status", "reset" }),
                new("OfficeMachine", new() { "print", "setPaper", "scan", "scanToEmail", "fax", "faxStatus", "status", "reset" }),
            };
            var ifaces = Interfaces(mode, methods);
            Console.WriteLine($"== {title}");
            Console.WriteLine($"  today: interfaces {ifaces.Count}; stub methods {TotalStubs(devices, ifaces)}; unused methods visible to clients {Noise(ifaces)}");

            // A: a new method, staple, that only the office machine can do.
            var beforeA = ifaces; int stubsBeforeA = TotalStubs(devices, ifaces);
            methods.Add("staple");
            devices[1].Methods.Add("staple");
            ifaces = Interfaces(mode, methods);
            var changed = ifaces.Where(i => Find(beforeA, i.Name) == null || Find(beforeA, i.Name)!.Methods.Count != i.Methods.Count).ToList();
            var hit = Clients.Where(c => changed.Any(i => Find(beforeA, i.Name) != null && Overlaps(c, Find(beforeA, i.Name)!))).ToList();
            var touched = devices.Where(d => changed.Any(i => Overlaps(d, i))).ToList();
            Console.WriteLine($"  A add method staple: new stubs {TotalStubs(devices, ifaces) - stubsBeforeA}; existing clients affected {hit.Count}; devices edited {touched.Count}");

            // B: a new device type that can only print and report status.
            var label = new Item("LabelPrinter", new() { "print", "status" });
            devices.Add(label);
            Console.WriteLine($"  B new device LabelPrinter: new stubs {StubsOf(label, ifaces)}; existing clients affected 0; devices edited 1");

            // C: print() gets a new parameter.
            var printIface = ifaces.First(i => i.Methods.Contains("print"));
            hit = Clients.Where(c => Overlaps(c, printIface)).ToList();
            touched = devices.Where(d => Overlaps(d, printIface)).ToList();
            Console.WriteLine($"  C change print(): new stubs 0; existing clients affected {hit.Count} ({string.Join(", ", hit.Select(c => c.Name))}); devices edited {touched.Count}");
            Console.WriteLine($"  after all three: interfaces {ifaces.Count}; stub methods {TotalStubs(devices, ifaces)}; unused methods visible to clients {Noise(ifaces)}");
        }
    }
}
